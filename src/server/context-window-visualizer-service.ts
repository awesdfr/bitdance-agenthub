import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ContextWindowActionType,
  ContextWindowBreakdownItem,
  ContextWindowContentType,
  ContextWindowImportance,
  ContextWindowSegment,
  ContextWindowSuggestion,
  ContextWindowVisualizationRow,
  JsonObject,
  RiskLevel,
} from '@/db/schema'
import { newContextWindowVisualizationId } from '@/server/ids'
import {
  previewAgentContextPack,
  type PackedContextSection,
} from '@/server/prompt-context-service'

export interface ContextWindowActionPlan {
  visualizationId: string
  actionType: ContextWindowActionType
  before: {
    tokenCapacity: number
    tokensUsed: number
    remainingTokens: number
    usedPercent: number
  }
  after: {
    tokenCapacity: number
    tokensUsed: number
    remainingTokens: number
    usedPercent: number
  }
  estimatedSavedTokens: number
  summary: string
  warnings: string[]
}

export async function createContextWindowVisualization(args: {
  agentProfileId: string
  employeeRunId?: string | null
  runtimeContextSnapshotId?: string | null
  goal: string
  input?: JsonObject
  tokenBudget?: number | null
  memoryLimit?: number
}): Promise<ContextWindowVisualizationRow> {
  const runtimeSnapshot = args.runtimeContextSnapshotId
    ? await getRequiredRuntimeContextSnapshot(args.runtimeContextSnapshotId)
    : null
  if (runtimeSnapshot?.agentProfileId && runtimeSnapshot.agentProfileId !== args.agentProfileId) {
    throw new Error('runtime_context_snapshot_agent_mismatch')
  }

  const preview = await previewAgentContextPack({
    agentProfileId: args.agentProfileId,
    goal: args.goal,
    input: args.input ?? {},
    tokenBudget: args.tokenBudget,
    memoryLimit: args.memoryLimit,
  })
  const segments = preview.sections.map((section) =>
    toContextWindowSegment(section, preview.tokenBudget, preview.tokenUsed),
  )
  const contentTypeBreakdown = buildBreakdown(
    segments,
    (segment) => segment.contentType,
    contentTypeLabel,
  )
  const importanceBreakdown = buildBreakdown(
    segments,
    (segment) => segment.importance,
    importanceLabel,
  )
  const suggestions = buildSuggestions({
    segments,
    tokenCapacity: preview.tokenBudget,
    tokensUsed: preview.tokenUsed,
    overflowTokens: preview.overflowTokens,
  })
  const row: ContextWindowVisualizationRow = {
    id: newContextWindowVisualizationId(),
    agentProfileId: args.agentProfileId,
    employeeRunId: normalizeOptional(args.employeeRunId) ?? runtimeSnapshot?.employeeRunId ?? null,
    runtimeContextSnapshotId: runtimeSnapshot?.id ?? normalizeOptional(args.runtimeContextSnapshotId),
    goal: args.goal.trim(),
    tokenCapacity: preview.tokenBudget,
    tokensUsed: preview.tokenUsed,
    tokenEstimate: preview.tokenEstimate,
    overflowTokens: preview.overflowTokens,
    remainingTokens: Math.max(0, preview.tokenBudget - preview.tokenUsed),
    usedPercent: roundPercent(preview.tokenUsed, preview.tokenBudget),
    segments,
    contentTypeBreakdown,
    importanceBreakdown,
    suggestions,
    compressibleTokens: suggestions.reduce(
      (sum, suggestion) => sum + Math.max(0, suggestion.estimatedTokenDelta),
      0,
    ),
    summary: buildSummary(preview.tokenBudget, preview.tokenUsed, preview.overflowTokens, suggestions),
    createdAt: Date.now(),
  }
  await db.insert(schema.contextWindowVisualizations).values(row)
  return row
}

export async function listContextWindowVisualizations(args: {
  agentProfileId?: string
  employeeRunId?: string
  limit?: number
} = {}): Promise<ContextWindowVisualizationRow[]> {
  const conditions: SQL[] = []
  if (args.agentProfileId) {
    conditions.push(eq(schema.contextWindowVisualizations.agentProfileId, args.agentProfileId))
  }
  if (args.employeeRunId) {
    conditions.push(eq(schema.contextWindowVisualizations.employeeRunId, args.employeeRunId))
  }
  return db.query.contextWindowVisualizations.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.contextWindowVisualizations.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function planContextWindowAction(
  visualizationId: string,
  actionType: ContextWindowActionType,
): Promise<ContextWindowActionPlan> {
  const visualization = await getRequiredVisualization(visualizationId)
  const before = {
    tokenCapacity: visualization.tokenCapacity,
    tokensUsed: visualization.tokensUsed,
    remainingTokens: visualization.remainingTokens,
    usedPercent: visualization.usedPercent,
  }
  const estimatedSavedTokens = estimateActionSavings(visualization, actionType)
  const tokenCapacity =
    actionType === 'expand_window'
      ? Math.max(
          visualization.tokenCapacity + 1024,
          Math.ceil(Math.max(visualization.tokenEstimate, visualization.tokensUsed) * 1.3),
        )
      : visualization.tokenCapacity
  const tokensUsed =
    actionType === 'expand_window'
      ? visualization.tokensUsed
      : Math.max(1, visualization.tokensUsed - estimatedSavedTokens)
  const after = {
    tokenCapacity,
    tokensUsed,
    remainingTokens: Math.max(0, tokenCapacity - tokensUsed),
    usedPercent: roundPercent(tokensUsed, tokenCapacity),
  }
  return {
    visualizationId,
    actionType,
    before,
    after,
    estimatedSavedTokens,
    summary: buildActionSummary(actionType, before, after, estimatedSavedTokens),
    warnings: buildActionWarnings(visualization, actionType, after),
  }
}

async function getRequiredVisualization(id: string): Promise<ContextWindowVisualizationRow> {
  const row = await db.query.contextWindowVisualizations.findFirst({
    where: eq(schema.contextWindowVisualizations.id, id),
  })
  if (!row) throw new Error(`Context window visualization not found: ${id}`)
  return row
}

async function getRequiredRuntimeContextSnapshot(id: string) {
  const row = await db.query.runtimeContextSnapshots.findFirst({
    where: eq(schema.runtimeContextSnapshots.id, id),
  })
  if (!row) throw new Error(`Runtime context snapshot not found: ${id}`)
  return row
}

function toContextWindowSegment(
  section: PackedContextSection,
  tokenCapacity: number,
  tokensUsed: number,
): ContextWindowSegment {
  const tokens = section.tokenUsed
  return {
    id: section.id,
    title: section.title,
    kind: section.kind,
    contentType: mapContentType(section.kind),
    importance: mapImportance(section.priority),
    status: section.status,
    tokens,
    estimatedTokens: section.tokenEstimate,
    shareOfUsed: roundPercent(tokens, Math.max(1, tokensUsed)),
    shareOfCapacity: roundPercent(tokens, tokenCapacity),
    barUnits: tokens > 0 ? Math.max(1, Math.round((tokens / Math.max(1, tokenCapacity)) * 40)) : 0,
    reason: section.reason,
  }
}

function mapContentType(kind: string): ContextWindowContentType {
  if (kind === 'system_prompt' || kind === 'user_sovereignty' || kind === 'style_guide') {
    return 'instruction'
  }
  if (kind === 'goal' || kind === 'prompt_template') return 'plan'
  if (kind === 'memory') return 'memory'
  if (kind === 'capability' || kind === 'agent_environment') return 'tool'
  if (kind === 'input' || kind === 'contract') return 'input'
  if (kind === 'policy') return 'policy'
  return 'other'
}

function mapImportance(priority: number): ContextWindowImportance {
  if (priority >= 92) return 'critical'
  if (priority >= 70) return 'important'
  return 'supporting'
}

function buildBreakdown<T extends string>(
  segments: ContextWindowSegment[],
  getKey: (segment: ContextWindowSegment) => T,
  getLabel: (key: T) => string,
): ContextWindowBreakdownItem[] {
  const totals = new Map<T, number>()
  for (const segment of segments) {
    if (segment.tokens <= 0) continue
    const key = getKey(segment)
    totals.set(key, (totals.get(key) ?? 0) + segment.tokens)
  }
  const totalTokens = Array.from(totals.values()).reduce((sum, tokens) => sum + tokens, 0)
  return Array.from(totals.entries())
    .map(([key, tokens]) => ({
      key,
      label: getLabel(key),
      tokens,
      percentage: roundPercent(tokens, Math.max(1, totalTokens)),
    }))
    .sort((a, b) => b.tokens - a.tokens)
}

function buildSuggestions(args: {
  segments: ContextWindowSegment[]
  tokenCapacity: number
  tokensUsed: number
  overflowTokens: number
}): ContextWindowSuggestion[] {
  const suggestions: ContextWindowSuggestion[] = []
  const usedPercent = args.tokensUsed / Math.max(1, args.tokenCapacity)
  const planTokens = tokenSum(args.segments, ['plan'])
  const memoryTokens = tokenSum(args.segments, ['memory'])
  const toolTokens = tokenSum(args.segments, ['tool'])
  const oldStepTokens = tokenSum(args.segments, ['observation', 'other'])
  const hasOmitted = args.segments.some((segment) => segment.status === 'omitted')
  const hasTruncated = args.segments.some((segment) => segment.status === 'truncated')

  if (planTokens >= 50 || hasTypePressure(args.segments, 'plan')) {
    suggestions.push(suggestion(
      'compress_plan',
      'Compress plan',
      'The current plan/prompt-template section is a visible chunk of the context window.',
      Math.ceil(planTokens * 0.3),
      'low',
    ))
  }
  if (memoryTokens >= 50 || hasTypePressure(args.segments, 'memory')) {
    suggestions.push(suggestion(
      'compress_memory',
      'Compress memories',
      'Relevant memories can be summarized while preserving titles and source ids.',
      Math.ceil(memoryTokens * 0.25),
      'medium',
    ))
  }
  if (toolTokens >= 50 || hasTypePressure(args.segments, 'tool')) {
    suggestions.push(suggestion(
      'trim_tools',
      'Trim tool definitions',
      'Tool and environment definitions can be narrowed to the tools needed for this task.',
      Math.ceil(toolTokens * 0.2),
      'medium',
    ))
  }
  if (usedPercent >= 0.75 || oldStepTokens > 0 || hasTruncated) {
    suggestions.push(suggestion(
      'remove_old_steps',
      'Remove old steps',
      'Older observations or lower-priority context can be summarized before the next model call.',
      Math.max(64, Math.ceil((oldStepTokens || args.tokensUsed) * 0.15)),
      'medium',
    ))
  }
  if (args.overflowTokens > 0 || hasOmitted) {
    suggestions.push(suggestion(
      'expand_window',
      'Expand window',
      'The context estimate exceeds the selected window, so a larger model/window would reduce omissions.',
      0,
      'low',
    ))
  }

  if (suggestions.length === 0 && args.tokensUsed > 0) {
    suggestions.push(suggestion(
      'compress_plan',
      'Compress plan',
      'The context is healthy; plan compression is the lowest-risk optional optimization.',
      Math.max(1, Math.ceil(args.tokensUsed * 0.05)),
      'low',
    ))
  }
  return suggestions
}

function suggestion(
  actionType: ContextWindowActionType,
  label: string,
  reason: string,
  estimatedTokenDelta: number,
  riskLevel: RiskLevel,
): ContextWindowSuggestion {
  return { actionType, label, reason, estimatedTokenDelta, riskLevel }
}

function hasTypePressure(segments: ContextWindowSegment[], contentType: ContextWindowContentType): boolean {
  return segments.some((segment) => segment.contentType === contentType && segment.status !== 'included')
}

function tokenSum(segments: ContextWindowSegment[], contentTypes: ContextWindowContentType[]): number {
  const set = new Set(contentTypes)
  return segments.reduce((sum, segment) => sum + (set.has(segment.contentType) ? segment.tokens : 0), 0)
}

function estimateActionSavings(
  visualization: ContextWindowVisualizationRow,
  actionType: ContextWindowActionType,
): number {
  if (actionType === 'expand_window') return 0
  const segments = visualization.segments
  if (actionType === 'compress_plan') return Math.max(1, Math.ceil(tokenSum(segments, ['plan']) * 0.3))
  if (actionType === 'compress_memory') return Math.max(1, Math.ceil(tokenSum(segments, ['memory']) * 0.25))
  if (actionType === 'trim_tools') return Math.max(1, Math.ceil(tokenSum(segments, ['tool']) * 0.2))
  return Math.max(1, Math.ceil((tokenSum(segments, ['observation', 'other']) || visualization.tokensUsed) * 0.15))
}

function buildSummary(
  tokenCapacity: number,
  tokensUsed: number,
  overflowTokens: number,
  suggestions: ContextWindowSuggestion[],
): string {
  const usedPercent = roundPercent(tokensUsed, tokenCapacity)
  const pressure = overflowTokens > 0 ? `${overflowTokens} overflow tokens` : `${tokenCapacity - tokensUsed} tokens free`
  return `Context window uses ${tokensUsed}/${tokenCapacity} tokens (${usedPercent}%) with ${pressure}; ${suggestions.length} optimization suggestions are available.`
}

function buildActionSummary(
  actionType: ContextWindowActionType,
  before: ContextWindowActionPlan['before'],
  after: ContextWindowActionPlan['after'],
  estimatedSavedTokens: number,
): string {
  if (actionType === 'expand_window') {
    return `Expanding the context window changes capacity from ${before.tokenCapacity} to ${after.tokenCapacity} tokens and lowers usage to ${after.usedPercent}%.`
  }
  return `${actionType} is expected to save about ${estimatedSavedTokens} tokens and lower usage from ${before.usedPercent}% to ${after.usedPercent}%.`
}

function buildActionWarnings(
  visualization: ContextWindowVisualizationRow,
  actionType: ContextWindowActionType,
  after: ContextWindowActionPlan['after'],
): string[] {
  const warnings: string[] = []
  if (actionType === 'compress_memory') {
    warnings.push('Verify memory summaries preserve source ids and customer preferences.')
  }
  if (actionType === 'trim_tools') {
    warnings.push('Confirm no required tool definitions are removed before execution.')
  }
  if (actionType === 'remove_old_steps') {
    warnings.push('Keep the most recent complete steps and only summarize early steps.')
  }
  if (after.remainingTokens < Math.ceil(visualization.tokenCapacity * 0.1)) {
    warnings.push('The window remains under high pressure after this action.')
  }
  return warnings
}

function contentTypeLabel(key: string): string {
  const labels: Record<string, string> = {
    instruction: 'Instructions',
    plan: 'Plan',
    memory: 'Memory',
    observation: 'Observation',
    tool: 'Tools',
    input: 'Input',
    policy: 'Policy',
    other: 'Other',
  }
  return labels[key] ?? key
}

function importanceLabel(key: string): string {
  const labels: Record<string, string> = {
    critical: 'Critical',
    important: 'Important',
    supporting: 'Supporting',
  }
  return labels[key] ?? key
}

function roundPercent(part: number, total: number): number {
  return Math.round((part / Math.max(1, total)) * 10000) / 100
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
