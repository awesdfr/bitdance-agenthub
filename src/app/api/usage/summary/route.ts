import { inArray, isNotNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { db, schema } from '@/db/client'
import type { MessageUsage, RunUsage } from '@/db/schema'
import { estimateTokens, getModelLimits } from '@/shared/model-registry'
import type { MessagePart } from '@/shared/types'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_CONTEXT_LIMIT = 1_000_000
const FILE_READ_CHAR_LIMIT = 50_000

export interface UsageBucket {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
  runs: number
}

export interface ContextUsageSummary {
  limitTokens: number
  usedTokens: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  otherTokens: number
  totalTokens: number
  percent: number
}

export interface RuntimeUsageSummary {
  elapsedMs: number
  requestCount: number
  conversationTokens: number
  cacheHitTokens: number
  cacheHitRate: number
  estimatedCostUsd: number
  contextStatus: 'normal' | 'near_limit' | 'over_limit'
  compressionPercent: number
  contextSummaryCount: number
}

export interface PromptCacheStrategySummary {
  mode: 'append_only_stable_prefix'
  label: string
  cacheablePrefixTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cacheHitRate: number
  targetHitRate: number
  effectiveInputCostPercent: number
  estimatedSavedUsd: number
  targetInputCostPercent: number
  stablePrefixSections: string[]
  recommendations: string[]
}

export interface ProjectContextUsageSummary {
  mode: 'lazy_files'
  fileReadCharLimit: number
  artifactStrategy: 'lazy_reference'
  keepsPinnedMessages: boolean
  summaryTokens: number
  rules: string[]
}

export interface UsageSummary {
  today: UsageBucket
  week: UsageBucket
  allTime: UsageBucket
  context: ContextUsageSummary
  runtime: RuntimeUsageSummary
  promptCache: PromptCacheStrategySummary
  projectContext: ProjectContextUsageSummary
  topConversations: Array<{
    id: string
    title: string
    totalTokens: number
    runs: number
    updatedAt: number
  }>
  byAgent: Array<{
    agentId: string
    name: string
    totalTokens: number
    runs: number
    estimatedCostUsd: number
    sharePercent: number
    avgTokensPerRun: number
  }>
  byModel: Array<
    UsageBucket & {
      model: string
      estimatedCostUsd: number
      estimatedUncachedPromptCostUsd: number
      estimatedSavedUsd: number
      sharePercent: number
      avgTokensPerRun: number
      cacheHitRate: number
    }
  >
}

type LimitsProvider = Parameters<typeof getModelLimits>[0]

function empty(): UsageBucket {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    runs: 0,
  }
}

function accumulate(
  bucket: UsageBucket,
  usage: Pick<RunUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens'> & {
    cacheCreationTokens?: number
  },
) {
  bucket.inputTokens += usage.inputTokens
  bucket.outputTokens += usage.outputTokens
  bucket.cacheReadTokens += usage.cacheReadTokens
  bucket.cacheCreationTokens += usage.cacheCreationTokens ?? 0
  bucket.totalTokens +=
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    (usage.cacheCreationTokens ?? 0)
  bucket.runs++
}

function providerForLimits(provider: string | null | undefined): LimitsProvider {
  if (
    provider === 'anthropic' ||
    provider === 'openai' ||
    provider === 'deepseek' ||
    provider === 'volcano-ark' ||
    provider === 'openai-compatible'
  ) {
    return provider
  }
  if (provider === 'custom' || provider === 'openrouter' || provider === 'ollama') {
    return 'openai-compatible'
  }
  return undefined
}

function estimateReasoningTokens(parts: MessagePart[] | null | undefined): number {
  if (!parts) return 0
  return parts.reduce((sum, part) => {
    if (part.type !== 'thinking') return sum
    return sum + estimateTokens(part.content)
  }, 0)
}

function contextStatus(percent: number): RuntimeUsageSummary['contextStatus'] {
  if (percent >= 100) return 'over_limit'
  if (percent >= 80) return 'near_limit'
  return 'normal'
}

function pricingForModel(topModel?: string) {
  const model = topModel?.toLowerCase() ?? ''
  return model.includes('deepseek-v4-pro')
    ? { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheCreation: 0.435 }
    : model.includes('deepseek')
      ? { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheCreation: 0.14 }
      : { input: 2.5, output: 10, cacheRead: 0.25, cacheCreation: 1.25 }
}

function estimateCostUsd(bucket: UsageBucket, topModel?: string): number {
  const rates = pricingForModel(topModel)

  return (
    (bucket.inputTokens / 1_000_000) * rates.input +
    (bucket.outputTokens / 1_000_000) * rates.output +
    (bucket.cacheReadTokens / 1_000_000) * rates.cacheRead +
    (bucket.cacheCreationTokens / 1_000_000) * rates.cacheCreation
  )
}

function estimatePromptCacheSavingsUsd(bucket: UsageBucket, topModel?: string) {
  const rates = pricingForModel(topModel)
  const cacheablePrefixTokens = bucket.inputTokens + bucket.cacheReadTokens + bucket.cacheCreationTokens
  const uncachedPromptCost = (cacheablePrefixTokens / 1_000_000) * rates.input
  const actualPromptCost =
    (bucket.inputTokens / 1_000_000) * rates.input +
    (bucket.cacheReadTokens / 1_000_000) * rates.cacheRead +
    (bucket.cacheCreationTokens / 1_000_000) * rates.cacheCreation

  return {
    actualPromptCost,
    uncachedPromptCost,
    estimatedSavedUsd: Math.max(0, uncachedPromptCost - actualPromptCost),
  }
}

function summarizePromptCache(bucket: UsageBucket, topModel?: string): PromptCacheStrategySummary {
  const rates = pricingForModel(topModel)
  const cacheablePrefixTokens = bucket.inputTokens + bucket.cacheReadTokens + bucket.cacheCreationTokens
  const uncachedPromptCost = (cacheablePrefixTokens / 1_000_000) * rates.input
  const actualPromptCost =
    (bucket.inputTokens / 1_000_000) * rates.input +
    (bucket.cacheReadTokens / 1_000_000) * rates.cacheRead +
    (bucket.cacheCreationTokens / 1_000_000) * rates.cacheCreation
  const cacheHitRate = cacheablePrefixTokens > 0 ? bucket.cacheReadTokens / cacheablePrefixTokens : 0
  const effectiveInputCostPercent =
    uncachedPromptCost > 0 ? Math.round((actualPromptCost / uncachedPromptCost) * 1000) / 10 : 100
  const estimatedSavedUsd = Math.max(0, uncachedPromptCost - actualPromptCost)

  return {
    mode: 'append_only_stable_prefix',
    label: '追加式上下文缓存',
    cacheablePrefixTokens,
    cacheReadTokens: bucket.cacheReadTokens,
    cacheCreationTokens: bucket.cacheCreationTokens,
    cacheHitRate,
    targetHitRate: 0.9,
    effectiveInputCostPercent,
    estimatedSavedUsd,
    targetInputCostPercent: 20,
    stablePrefixSections: [
      '系统提示词与员工身份',
      '工具、Skills、MCP 和 CLI 清单',
      '项目索引与置顶记忆',
      '上一轮完整对话前缀',
    ],
    recommendations: [
      '同一会话继续追加消息，不要每轮重建 prompt。',
      '系统提示词、工具清单和项目索引保持字节级稳定。',
      '变化内容放在尾部，长会话接近上限时再摘要压缩。',
      '模型支持 prefix cache 时优先复用同一模型与同一出口。',
    ],
  }
}

export async function GET() {
  const [runs, messageRows, conversationRows, modelProfileRows, contextSummaryRows] =
    await Promise.all([
      db.query.agentRuns.findMany({ where: isNotNull(schema.agentRuns.usage) }),
      db.query.messages.findMany({ where: isNotNull(schema.messages.usage) }),
      db.query.conversations.findMany(),
      db.query.modelProfiles.findMany(),
      db.query.contextSummaries.findMany(),
    ])

  const modelProfileById = new Map(modelProfileRows.map((row) => [row.id, row]))
  const conversationById = new Map(conversationRows.map((row) => [row.id, row]))
  const now = Date.now()
  const todayStart = now - DAY_MS
  const weekStart = now - 7 * DAY_MS

  const today = empty()
  const week = empty()
  const allTime = empty()
  const byAgentMap = new Map<string, UsageBucket>()
  const byModelMap = new Map<string, UsageBucket>()
  const byConvMap = new Map<string, UsageBucket>()

  let latestInputTokens = 0
  let elapsedMs = 0

  for (const row of runs) {
    const usage = row.usage as RunUsage | null
    if (!usage) continue

    accumulate(allTime, usage)
    if (row.startedAt >= weekStart) accumulate(week, usage)
    if (row.startedAt >= todayStart) accumulate(today, usage)

    let agentBucket = byAgentMap.get(row.agentId)
    if (!agentBucket) {
      agentBucket = empty()
      byAgentMap.set(row.agentId, agentBucket)
    }
    accumulate(agentBucket, usage)

    if (usage.model) {
      let modelBucket = byModelMap.get(usage.model)
      if (!modelBucket) {
        modelBucket = empty()
        byModelMap.set(usage.model, modelBucket)
      }
      accumulate(modelBucket, usage)
    }

    let conversationBucket = byConvMap.get(row.conversationId)
    if (!conversationBucket) {
      conversationBucket = empty()
      byConvMap.set(row.conversationId, conversationBucket)
    }
    accumulate(conversationBucket, usage)

    latestInputTokens = Math.max(latestInputTokens, usage.lastInputTokens ?? usage.inputTokens)
    elapsedMs += Math.max(0, (row.finishedAt ?? now) - row.startedAt)
  }

  let reasoningTokens = 0

  for (const row of messageRows) {
    reasoningTokens += estimateReasoningTokens(row.parts)

    // Agent runs already write cumulative usage. Message usage without a run belongs to simple model chat.
    if (row.runId || row.role !== 'agent') continue

    const usage = row.usage as MessageUsage | null
    if (!usage) continue

    accumulate(allTime, usage)
    if (row.createdAt >= weekStart) accumulate(week, usage)
    if (row.createdAt >= todayStart) accumulate(today, usage)

    const agentId = row.agentId ?? '__model_chat__'
    let agentBucket = byAgentMap.get(agentId)
    if (!agentBucket) {
      agentBucket = empty()
      byAgentMap.set(agentId, agentBucket)
    }
    accumulate(agentBucket, usage)

    const conversation = conversationById.get(row.conversationId)
    const profile = conversation?.modelProfileId
      ? modelProfileById.get(conversation.modelProfileId)
      : undefined
    const model = profile?.model ?? '普通模型对话'
    let modelBucket = byModelMap.get(model)
    if (!modelBucket) {
      modelBucket = empty()
      byModelMap.set(model, modelBucket)
    }
    accumulate(modelBucket, usage)

    let conversationBucket = byConvMap.get(row.conversationId)
    if (!conversationBucket) {
      conversationBucket = empty()
      byConvMap.set(row.conversationId, conversationBucket)
    }
    accumulate(conversationBucket, usage)

    latestInputTokens = Math.max(latestInputTokens, usage.inputTokens)
  }

  const modelLimits = modelProfileRows.map((profile) => {
    if (profile.contextWindow && profile.contextWindow > 0) return profile.contextWindow
    return getModelLimits(providerForLimits(profile.provider), profile.model).contextWindow
  })
  const limitTokens = Math.max(DEFAULT_CONTEXT_LIMIT, ...modelLimits)
  const usedTokens = Math.min(limitTokens, latestInputTokens)
  const percent = limitTokens > 0 ? Math.round((usedTokens / limitTokens) * 1000) / 10 : 0

  const promptTokens = allTime.inputTokens
  const cappedReasoningTokens = Math.min(reasoningTokens, allTime.outputTokens)
  const completionTokens = Math.max(0, allTime.outputTokens - cappedReasoningTokens)
  const otherTokens = allTime.cacheReadTokens + allTime.cacheCreationTokens
  const topModel = Array.from(byModelMap.entries()).sort(
    (a, b) => b[1].totalTokens - a[1].totalTokens,
  )[0]?.[0]
  const cacheBase =
    allTime.inputTokens + allTime.cacheReadTokens + allTime.cacheCreationTokens
  const summaryTokens = contextSummaryRows.reduce((sum, row) => sum + row.tokenEstimate, 0)
  const compressionPercent =
    allTime.totalTokens > 0
      ? Math.max(0, Math.min(95, Math.round((summaryTokens / allTime.totalTokens) * 100)))
      : contextSummaryRows.length > 0
        ? 80
        : 0

  const agentIdsForLookup = Array.from(byAgentMap.keys()).filter(
    (id) => id !== '__model_chat__',
  )
  const agentRows =
    agentIdsForLookup.length > 0
      ? await db.query.agents.findMany({
          where: inArray(schema.agents.id, agentIdsForLookup),
        })
      : []
  const agentNameById = new Map(agentRows.map((agent) => [agent.id, agent.name]))
  agentNameById.set('__model_chat__', '普通模型对话')

  const topConvIds = Array.from(byConvMap.entries())
    .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
    .slice(0, 10)
    .map(([id]) => id)

  const byModel = Array.from(byModelMap.entries())
    .map(([model, bucket]) => {
      const cacheBase = bucket.inputTokens + bucket.cacheReadTokens + bucket.cacheCreationTokens
      const savings = estimatePromptCacheSavingsUsd(bucket, model)
      return {
        model,
        inputTokens: bucket.inputTokens,
        outputTokens: bucket.outputTokens,
        cacheReadTokens: bucket.cacheReadTokens,
        cacheCreationTokens: bucket.cacheCreationTokens,
        totalTokens: bucket.totalTokens,
        runs: bucket.runs,
        estimatedCostUsd: estimateCostUsd(bucket, model),
        estimatedUncachedPromptCostUsd: savings.uncachedPromptCost,
        estimatedSavedUsd: savings.estimatedSavedUsd,
        sharePercent: allTime.totalTokens > 0 ? bucket.totalTokens / allTime.totalTokens : 0,
        avgTokensPerRun: bucket.runs > 0 ? bucket.totalTokens / bucket.runs : 0,
        cacheHitRate: cacheBase > 0 ? bucket.cacheReadTokens / cacheBase : 0,
      }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)

  const summary: UsageSummary = {
    today,
    week,
    allTime,
    context: {
      limitTokens,
      usedTokens,
      promptTokens,
      completionTokens,
      reasoningTokens: cappedReasoningTokens,
      otherTokens,
      totalTokens: promptTokens + completionTokens + cappedReasoningTokens + otherTokens,
      percent,
    },
    runtime: {
      elapsedMs,
      requestCount: allTime.runs,
      conversationTokens: allTime.totalTokens,
      cacheHitTokens: allTime.cacheReadTokens,
      cacheHitRate: cacheBase > 0 ? allTime.cacheReadTokens / cacheBase : 0,
      estimatedCostUsd: estimateCostUsd(allTime, topModel),
      contextStatus: contextStatus(percent),
      compressionPercent,
      contextSummaryCount: contextSummaryRows.length,
    },
    promptCache: summarizePromptCache(allTime, topModel),
    projectContext: {
      mode: 'lazy_files',
      fileReadCharLimit: FILE_READ_CHAR_LIMIT,
      artifactStrategy: 'lazy_reference',
      keepsPinnedMessages: true,
      summaryTokens,
      rules: [
        '工程文件先建索引，不整库塞进 prompt',
        '只按任务读取相关文件，单次文本读取有上限',
        '二进制文件只进元数据，产物正文按需打开',
        '长会话用摘要压缩，重要消息保持置顶',
      ],
    },
    topConversations: topConvIds
      .map((id) => {
        const conversation = conversationById.get(id)
        const bucket = byConvMap.get(id)
        if (!conversation || !bucket) return null
        return {
          id,
          title: conversation.title,
          totalTokens: bucket.totalTokens,
          runs: bucket.runs,
          updatedAt: conversation.updatedAt,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    byAgent: Array.from(byAgentMap.entries())
      .map(([agentId, bucket]) => ({
        agentId,
        name: agentNameById.get(agentId) ?? agentId,
        totalTokens: bucket.totalTokens,
        runs: bucket.runs,
        estimatedCostUsd: estimateCostUsd(bucket, topModel),
        sharePercent: allTime.totalTokens > 0 ? bucket.totalTokens / allTime.totalTokens : 0,
        avgTokensPerRun: bucket.runs > 0 ? bucket.totalTokens / bucket.runs : 0,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byModel,
  }

  return NextResponse.json(summary)
}
