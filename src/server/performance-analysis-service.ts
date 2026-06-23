import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  PerformanceAnalysisRunRow,
  PerformanceAnalysisScope,
  PerformanceOptimizationRecommendationRow,
} from '@/db/schema'
import { newPerformanceAnalysisRunId, newPerformanceRecommendationId } from '@/server/ids'

interface TimedSample {
  name: string
  durationMs: number
  metadata: JsonObject
}

interface RecommendationDraft {
  recommendationType: string
  target: string
  message: string
  estimatedImpact: string
  evidence: JsonObject
}

export async function runPerformanceAnalysis(args: {
  scope?: PerformanceAnalysisScope
  agentProfileId?: string | null
  windowStart?: number | null
  windowEnd?: number | null
  samples?: JsonObject
}): Promise<{
  run: PerformanceAnalysisRunRow
  recommendations: PerformanceOptimizationRecommendationRow[]
}> {
  const samples = args.samples ?? {}
  const stepSamples = readTimedSamples(samples, 'stepDurations', 'phase')
  const toolSamples = readTimedSamples(samples, 'toolLatencies', 'toolName')
  const sqliteSlowQueries = readSqliteQueries(samples)
  const memorySnapshot = objectAt(samples.memorySnapshot)
  const processMetrics = objectAt(samples.processMetrics)
  const memoryFlamegraph = objectAt(samples.memoryFlamegraph)
  const allDurations = [...stepSamples, ...toolSamples].map((sample) => sample.durationMs)
  const now = Date.now()
  const runId = newPerformanceAnalysisRunId()
  const slowestSteps = topSlowest(stepSamples)
  const slowestTools = topSlowest(toolSamples)
  const summary = buildSummary({
    stepSamples,
    toolSamples,
    sqliteSlowQueries,
    memorySnapshot,
    processMetrics,
  })

  await db.insert(schema.performanceAnalysisRuns).values({
    id: runId,
    scope: args.scope ?? 'workspace',
    agentProfileId: args.agentProfileId ?? null,
    status: 'completed',
    windowStart: args.windowStart ?? null,
    windowEnd: args.windowEnd ?? null,
    p50LatencyMs: percentile(allDurations, 50),
    p95LatencyMs: percentile(allDurations, 95),
    p99LatencyMs: percentile(allDurations, 99),
    slowestSteps,
    slowestTools,
    sqliteSlowQueries,
    memoryFlamegraph,
    processMetrics,
    summary,
    createdAt: now,
  })

  const run = await getRequiredPerformanceAnalysisRun(runId)
  const recommendations: PerformanceOptimizationRecommendationRow[] = []
  for (const draft of buildRecommendations({ stepSamples, toolSamples, sqliteSlowQueries, memorySnapshot })) {
    const recommendation = {
      id: newPerformanceRecommendationId(),
      analysisRunId: run.id,
      recommendationType: draft.recommendationType,
      target: draft.target,
      message: draft.message,
      estimatedImpact: draft.estimatedImpact,
      evidence: draft.evidence,
      status: 'open' as const,
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(schema.performanceOptimizationRecommendations).values(recommendation)
    recommendations.push(recommendation)
  }
  return { run, recommendations }
}

export async function listPerformanceAnalysisRuns(args: {
  scope?: PerformanceAnalysisScope
  agentProfileId?: string
} = {}): Promise<PerformanceAnalysisRunRow[]> {
  return db.query.performanceAnalysisRuns.findMany({
    where: args.agentProfileId
      ? eq(schema.performanceAnalysisRuns.agentProfileId, args.agentProfileId)
      : args.scope
        ? eq(schema.performanceAnalysisRuns.scope, args.scope)
        : undefined,
    orderBy: [desc(schema.performanceAnalysisRuns.createdAt)],
    limit: 100,
  })
}

export async function listPerformanceOptimizationRecommendations(args: {
  analysisRunId?: string
} = {}): Promise<PerformanceOptimizationRecommendationRow[]> {
  return db.query.performanceOptimizationRecommendations.findMany({
    where: args.analysisRunId
      ? eq(schema.performanceOptimizationRecommendations.analysisRunId, args.analysisRunId)
      : undefined,
    orderBy: [desc(schema.performanceOptimizationRecommendations.createdAt)],
    limit: 100,
  })
}

async function getRequiredPerformanceAnalysisRun(id: string): Promise<PerformanceAnalysisRunRow> {
  const row = await db.query.performanceAnalysisRuns.findFirst({
    where: eq(schema.performanceAnalysisRuns.id, id),
  })
  if (!row) throw new Error(`Performance analysis run not found: ${id}`)
  return row
}

function readTimedSamples(samples: JsonObject, key: string, nameKey: string): TimedSample[] {
  const value = samples[key]
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!isPlainObject(item)) return []
    const durationMs = numberAt(item.durationMs)
    if (durationMs === null) return []
    return [
      {
        name: stringAt(item[nameKey]) ?? stringAt(item.name) ?? `${key}.${index + 1}`,
        durationMs,
        metadata: item,
      },
    ]
  })
}

function readSqliteQueries(samples: JsonObject): JsonObject[] {
  const value = samples.sqliteQueries
  if (!Array.isArray(value)) return []
  return value
    .filter(isPlainObject)
    .map((query) => ({
      sql: stringAt(query.sql) ?? 'unknown',
      durationMs: numberAt(query.durationMs) ?? 0,
      table: stringAt(query.table) ?? '',
    }))
    .filter((query) => typeof query.durationMs === 'number' && query.durationMs >= 50)
    .sort((a, b) => Number(b.durationMs) - Number(a.durationMs))
    .slice(0, 5)
}

function buildSummary(args: {
  stepSamples: TimedSample[]
  toolSamples: TimedSample[]
  sqliteSlowQueries: JsonObject[]
  memorySnapshot: JsonObject
  processMetrics: JsonObject
}): JsonObject {
  return {
    stepSampleCount: args.stepSamples.length,
    toolSampleCount: args.toolSamples.length,
    sqliteSlowQueryCount: args.sqliteSlowQueries.length,
    memoryGrowthPercent: numberAt(args.memorySnapshot.memoryGrowthPercent) ?? 0,
    browserProfileMb: Math.round((numberAt(args.memorySnapshot.browserProfileBytes) ?? 0) / 1024 / 1024),
    processMetrics: args.processMetrics,
  }
}

function buildRecommendations(args: {
  stepSamples: TimedSample[]
  toolSamples: TimedSample[]
  sqliteSlowQueries: JsonObject[]
  memorySnapshot: JsonObject
}): RecommendationDraft[] {
  const drafts: RecommendationDraft[] = []
  const planAverage = averageDuration(args.stepSamples.filter((sample) => sample.name === 'plan_creation'))
  const promptTokenAverage = numberAt(args.memorySnapshot.promptTokenAverage)
  const promptTokenTarget = numberAt(args.memorySnapshot.promptTokenTarget) ?? 2000
  if (planAverage >= 10_000 && promptTokenAverage && promptTokenAverage > promptTokenTarget) {
    drafts.push({
      recommendationType: 'prompt_simplification',
      target: 'plan_creation',
      message: `plan_creation平均${Math.round(planAverage / 1000)}s建议简化prompt(${promptTokenAverage}→${promptTokenTarget})`,
      estimatedImpact: 'high',
      evidence: { averageDurationMs: planAverage, promptTokenAverage, promptTokenTarget },
    })
  }

  const memoryGrowthPercent = numberAt(args.memorySnapshot.memoryGrowthPercent)
  if (memoryGrowthPercent && memoryGrowthPercent >= 45) {
    drafts.push({
      recommendationType: 'memory_cleanup',
      target: 'memory_store',
      message: `记忆库增长${memoryGrowthPercent}%建议清理`,
      estimatedImpact: 'medium',
      evidence: { memoryGrowthPercent },
    })
  }

  const browserProfileBytes = numberAt(args.memorySnapshot.browserProfileBytes)
  if (browserProfileBytes && browserProfileBytes >= 800 * 1024 * 1024) {
    drafts.push({
      recommendationType: 'browser_profile_cleanup',
      target: 'browser_profile',
      message: `浏览器Profile ${Math.round(browserProfileBytes / 1024 / 1024)}MB建议清理`,
      estimatedImpact: 'medium',
      evidence: { browserProfileBytes },
    })
  }

  const slowestSql = args.sqliteSlowQueries[0]
  if (slowestSql && Number(slowestSql.durationMs) >= 100) {
    drafts.push({
      recommendationType: 'sqlite_slow_query',
      target: stringAt(slowestSql.table) || 'sqlite',
      message: `SQLite慢查询${Number(slowestSql.durationMs)}ms建议检查索引或查询计划`,
      estimatedImpact: 'medium',
      evidence: slowestSql,
    })
  }

  const slowestTool = [...args.toolSamples].sort((a, b) => b.durationMs - a.durationMs)[0]
  if (slowestTool && slowestTool.durationMs >= 15_000) {
    drafts.push({
      recommendationType: 'slow_tool',
      target: slowestTool.name,
      message: `${slowestTool.name} P99接近${Math.round(slowestTool.durationMs / 1000)}s建议设置超时/缓存/替代工具`,
      estimatedImpact: 'high',
      evidence: { durationMs: slowestTool.durationMs, metadata: slowestTool.metadata },
    })
  }

  return drafts
}

function topSlowest(samples: TimedSample[]): JsonObject[] {
  return [...samples]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5)
    .map((sample) => ({
      name: sample.name,
      durationMs: sample.durationMs,
      metadata: sample.metadata,
    }))
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function averageDuration(samples: TimedSample[]): number {
  if (!samples.length) return 0
  return Math.round(samples.reduce((sum, sample) => sum + sample.durationMs, 0) / samples.length)
}

function objectAt(value: unknown): JsonObject {
  return isPlainObject(value) ? value : {}
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringAt(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
