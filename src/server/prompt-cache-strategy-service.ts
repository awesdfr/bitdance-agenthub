import type { AgentRow, ModelProfileRow } from '@/db/schema'
import { getModelLimits } from '@/shared/model-registry'

export type PromptCacheMode = 'append_only_stable_prefix' | 'bounded_recent_history'

export interface PromptCachePlan {
  mode: PromptCacheMode
  appendOnly: boolean
  historyLimit: number
  reserveTokens: number
  reason: string
  stablePrefixSections: string[]
  targetHitRate: number
  targetInputCostPercent: number
}

export const DEFAULT_RECENT_HISTORY_LIMIT = 30
export const APPEND_ONLY_HISTORY_LIMIT = 2000

const APPEND_ONLY_CONTEXT_THRESHOLD = 256_000

const STABLE_PREFIX_SECTIONS = [
  '系统提示词与员工身份',
  '工具、Skills、MCP 和 CLI 清单',
  '项目索引与置顶记忆',
  '上一轮完整对话前缀',
]

export function planAgentPromptCache(args: {
  provider: AgentRow['modelProvider']
  modelId: string | null
  contextWindow: number
}): PromptCachePlan {
  return buildPromptCachePlan({
    provider: args.provider ?? undefined,
    model: args.modelId,
    baseUrl: null,
    contextWindow: args.contextWindow,
  })
}

export function planModelProfilePromptCache(profile: ModelProfileRow): PromptCachePlan {
  return buildPromptCachePlan({
    provider: profile.provider,
    model: profile.model,
    baseUrl: profile.baseUrl,
    contextWindow: getModelProfileContextWindow(profile),
  })
}

export function getModelProfileContextWindow(profile: ModelProfileRow): number {
  if (profile.contextWindow && profile.contextWindow > 0) return profile.contextWindow
  return getModelLimits(providerForLimits(profile.provider), profile.model).contextWindow
}

function buildPromptCachePlan(args: {
  provider?: string | null
  model?: string | null
  baseUrl?: string | null
  contextWindow: number
}): PromptCachePlan {
  const provider = (args.provider ?? '').toLowerCase()
  const model = (args.model ?? '').toLowerCase()
  const baseUrl = (args.baseUrl ?? '').toLowerCase()
  const supportsAppendOnly =
    provider === 'deepseek' ||
    model.includes('deepseek') ||
    (args.contextWindow >= APPEND_ONLY_CONTEXT_THRESHOLD && baseUrl.includes('deepseek'))

  if (supportsAppendOnly) {
    return {
      mode: 'append_only_stable_prefix',
      appendOnly: true,
      historyLimit: APPEND_ONLY_HISTORY_LIMIT,
      reserveTokens: modelOnlyReserveTokens(args.contextWindow),
      reason: '模型支持或疑似支持 prefix-cache，优先保持字节级稳定前缀。',
      stablePrefixSections: STABLE_PREFIX_SECTIONS,
      targetHitRate: 0.9,
      targetInputCostPercent: 20,
    }
  }

  return {
    mode: 'bounded_recent_history',
    appendOnly: false,
    historyLimit: DEFAULT_RECENT_HISTORY_LIMIT,
    reserveTokens: modelOnlyReserveTokens(args.contextWindow),
    reason: '模型未声明 prefix-cache，使用最近历史与摘要控制上下文。',
    stablePrefixSections: STABLE_PREFIX_SECTIONS.slice(0, 3),
    targetHitRate: 0,
    targetInputCostPercent: 100,
  }
}

function modelOnlyReserveTokens(contextWindow: number): number {
  return Math.min(64_000, Math.max(4096, Math.floor(contextWindow * 0.08)))
}

function providerForLimits(provider: string | null | undefined): Parameters<typeof getModelLimits>[0] {
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
