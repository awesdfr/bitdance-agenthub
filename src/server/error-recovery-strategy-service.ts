import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ErrorClassificationRow,
  ErrorSeverity,
  ErrorTaxonomyCategory,
  JsonObject,
  RecoveryStrategyAttemptRow,
  RecoveryStrategyOutcome,
  RecoveryStrategyStatsRow,
  RecoveryStrategyType,
} from '@/db/schema'
import {
  newErrorClassificationId,
  newRecoveryStrategyAttemptId,
  newRecoveryStrategyStatsId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface ClassifyRuntimeErrorArgs {
  resourceType?: string
  resourceId?: string
  agentProfileId?: string | null
  message: string
  context?: JsonObject
}

export interface RecordRecoveryStrategyAttemptArgs {
  classificationId: string
  strategyType: RecoveryStrategyType
  strategyConfig?: JsonObject
  outcome: RecoveryStrategyOutcome
  durationMs?: number
  notes?: string
}

export interface RecoveryStrategyCandidate {
  strategyType: RecoveryStrategyType
  strategyConfig: JsonObject
  priorSuccessRate: number
  reason: string
}

export async function classifyRuntimeError(
  args: ClassifyRuntimeErrorArgs,
): Promise<ErrorClassificationRow> {
  const message = normalizeRequired(args.message, 'message')
  await assertAgentExists(args.agentProfileId ?? null)

  const context = args.context ?? {}
  const normalizedError = normalizeErrorText(message, context)
  const category = detectCategory(normalizedError)
  const severity = detectSeverity(category, normalizedError)
  const strategyRankings = await rankRecoveryStrategies({
    category,
    severity,
    agentProfileId: args.agentProfileId ?? null,
    context,
  })
  const selected = strategyRankings[0] ?? fallbackRanking(category, severity)
  const id = newErrorClassificationId()
  const row: ErrorClassificationRow = {
    id,
    resourceType: normalizeOptional(args.resourceType) ?? 'runtime_error',
    resourceId: normalizeOptional(args.resourceId) ?? `error:${id}`,
    agentProfileId: normalizeOptional(args.agentProfileId),
    category,
    severity,
    message,
    normalizedError,
    context,
    suggestedStrategy: selected.strategyType as RecoveryStrategyType,
    suggestedStrategyConfig: asJsonObject(selected.strategyConfig),
    strategyRankings: strategyRankings.map((ranking, index) => ({
      ...ranking,
      selected: index === 0,
    })),
    confidence: confidenceForCategory(category, normalizedError),
    createdAt: Date.now(),
  }

  await db.insert(schema.errorClassifications).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'error_recovery.classify',
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    riskLevel: row.severity === 'fatal' ? 'high' : 'medium',
    status: row.severity === 'fatal' ? 'warning' : 'allowed',
    message: `Classified ${row.category} as ${row.severity}; suggested ${row.suggestedStrategy}.`,
    metadata: {
      errorClassificationId: row.id,
      category: row.category,
      severity: row.severity,
      suggestedStrategy: row.suggestedStrategy,
    },
  })
  return row
}

export async function recommendRecoveryStrategy(args: {
  category: ErrorTaxonomyCategory
  severity?: ErrorSeverity
  agentProfileId?: string | null
  context?: JsonObject
}): Promise<JsonObject> {
  await assertAgentExists(args.agentProfileId ?? null)
  const rankings = await rankRecoveryStrategies({
    category: args.category,
    severity: args.severity ?? 'recoverable',
    agentProfileId: args.agentProfileId ?? null,
    context: args.context ?? {},
  })
  return {
    category: args.category,
    severity: args.severity ?? 'recoverable',
    recommended: rankings[0] ?? fallbackRanking(args.category, args.severity ?? 'recoverable'),
    rankings,
  }
}

export async function listErrorClassifications(args: {
  agentProfileId?: string
  resourceType?: string
  resourceId?: string
  category?: ErrorTaxonomyCategory
  severity?: ErrorSeverity
  limit?: number
} = {}): Promise<ErrorClassificationRow[]> {
  const filters: SQL[] = []
  if (args.agentProfileId) filters.push(eq(schema.errorClassifications.agentProfileId, args.agentProfileId))
  if (args.resourceType) filters.push(eq(schema.errorClassifications.resourceType, args.resourceType))
  if (args.resourceId) filters.push(eq(schema.errorClassifications.resourceId, args.resourceId))
  if (args.category) filters.push(eq(schema.errorClassifications.category, args.category))
  if (args.severity) filters.push(eq(schema.errorClassifications.severity, args.severity))
  return db.query.errorClassifications.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.errorClassifications.createdAt)],
    limit: clampLimit(args.limit),
  })
}

export async function recordRecoveryStrategyAttempt(
  args: RecordRecoveryStrategyAttemptArgs,
): Promise<{
  attempt: RecoveryStrategyAttemptRow
  stats: RecoveryStrategyStatsRow
}> {
  const classification = await getRequiredClassification(args.classificationId)
  const strategyConfig = args.strategyConfig ?? {}
  const now = Date.now()
  const success = args.outcome === 'succeeded'
  const attempt: RecoveryStrategyAttemptRow = {
    id: newRecoveryStrategyAttemptId(),
    classificationId: classification.id,
    agentProfileId: classification.agentProfileId,
    category: classification.category,
    strategyType: args.strategyType,
    strategyConfig,
    outcome: args.outcome,
    success,
    durationMs: Math.max(0, Math.floor(args.durationMs ?? 0)),
    notes: args.notes?.trim() ?? '',
    createdAt: now,
  }
  await db.insert(schema.recoveryStrategyAttempts).values(attempt)
  const stats = await updateStrategyStats({
    agentProfileId: classification.agentProfileId,
    category: classification.category,
    strategyType: args.strategyType,
    outcome: args.outcome,
    success,
    now,
  })
  await recordAuditLog({
    actorType: 'system',
    action: 'error_recovery.strategy_attempt',
    resourceType: classification.resourceType,
    resourceId: classification.resourceId,
    riskLevel: success ? 'low' : 'medium',
    status: success ? 'allowed' : 'warning',
    message: `Recovery strategy ${args.strategyType} ${args.outcome} for ${classification.category}.`,
    metadata: {
      errorClassificationId: classification.id,
      recoveryStrategyAttemptId: attempt.id,
      strategyStatsId: stats.id,
      successRate: stats.successRate,
    },
  })
  return { attempt, stats }
}

export async function listRecoveryStrategyAttempts(args: {
  classificationId?: string
  agentProfileId?: string
  category?: ErrorTaxonomyCategory
  strategyType?: RecoveryStrategyType
  outcome?: RecoveryStrategyOutcome
  limit?: number
} = {}): Promise<RecoveryStrategyAttemptRow[]> {
  const filters: SQL[] = []
  if (args.classificationId) filters.push(eq(schema.recoveryStrategyAttempts.classificationId, args.classificationId))
  if (args.agentProfileId) filters.push(eq(schema.recoveryStrategyAttempts.agentProfileId, args.agentProfileId))
  if (args.category) filters.push(eq(schema.recoveryStrategyAttempts.category, args.category))
  if (args.strategyType) filters.push(eq(schema.recoveryStrategyAttempts.strategyType, args.strategyType))
  if (args.outcome) filters.push(eq(schema.recoveryStrategyAttempts.outcome, args.outcome))
  return db.query.recoveryStrategyAttempts.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.recoveryStrategyAttempts.createdAt)],
    limit: clampLimit(args.limit),
  })
}

export async function listRecoveryStrategyStats(args: {
  agentProfileId?: string
  category?: ErrorTaxonomyCategory
  strategyType?: RecoveryStrategyType
  limit?: number
} = {}): Promise<RecoveryStrategyStatsRow[]> {
  const filters: SQL[] = []
  if (args.agentProfileId) filters.push(eq(schema.recoveryStrategyStats.agentProfileId, args.agentProfileId))
  if (args.category) filters.push(eq(schema.recoveryStrategyStats.category, args.category))
  if (args.strategyType) filters.push(eq(schema.recoveryStrategyStats.strategyType, args.strategyType))
  return db.query.recoveryStrategyStats.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.recoveryStrategyStats.updatedAt)],
    limit: clampLimit(args.limit),
  })
}

async function rankRecoveryStrategies(args: {
  category: ErrorTaxonomyCategory
  severity: ErrorSeverity
  agentProfileId: string | null
  context: JsonObject
}): Promise<JsonObject[]> {
  const candidates = strategyCandidates(args.category, args.severity, args.context)
  const statsRows = await db.query.recoveryStrategyStats.findMany({
    where: eq(schema.recoveryStrategyStats.category, args.category),
  })
  return candidates
    .map((candidate) => {
      const stats = bestStatsForStrategy(statsRows, candidate.strategyType, args.agentProfileId)
      const hasHistory = Boolean(stats && stats.attemptCount > 0)
      const historicalSuccessRate = stats?.successRate ?? null
      const effectiveRate = hasHistory ? Number(stats?.successRate ?? 0) : candidate.priorSuccessRate
      const confidenceBoost = Math.min(stats?.attemptCount ?? 0, 30) * 0.001
      return {
        strategyType: candidate.strategyType,
        strategyConfig: candidate.strategyConfig,
        reason: candidate.reason,
        historicalAttemptCount: stats?.attemptCount ?? 0,
        historicalSuccessRate,
        priorSuccessRate: candidate.priorSuccessRate,
        score: round(effectiveRate + confidenceBoost, 4),
      }
    })
    .sort((left, right) => {
      const leftScore = getNumber(left, 'score')
      const rightScore = getNumber(right, 'score')
      if (rightScore !== leftScore) return rightScore - leftScore
      return strategyPriority(left.strategyType as RecoveryStrategyType) -
        strategyPriority(right.strategyType as RecoveryStrategyType)
    })
}

async function updateStrategyStats(args: {
  agentProfileId: string | null
  category: ErrorTaxonomyCategory
  strategyType: RecoveryStrategyType
  outcome: RecoveryStrategyOutcome
  success: boolean
  now: number
}): Promise<RecoveryStrategyStatsRow> {
  const existing = (await db.query.recoveryStrategyStats.findMany({
    where: and(
      eq(schema.recoveryStrategyStats.category, args.category),
      eq(schema.recoveryStrategyStats.strategyType, args.strategyType),
    ),
  })).find((row) => (row.agentProfileId ?? null) === args.agentProfileId)

  if (!existing) {
    const attemptCount = 1
    const successCount = args.success ? 1 : 0
    const failureCount = args.success ? 0 : 1
    const row: RecoveryStrategyStatsRow = {
      id: newRecoveryStrategyStatsId(),
      agentProfileId: args.agentProfileId,
      category: args.category,
      strategyType: args.strategyType,
      attemptCount,
      successCount,
      failureCount,
      successRate: round(successCount / attemptCount, 4),
      lastOutcome: args.outcome,
      createdAt: args.now,
      updatedAt: args.now,
    }
    await db.insert(schema.recoveryStrategyStats).values(row)
    return row
  }

  const attemptCount = existing.attemptCount + 1
  const successCount = existing.successCount + (args.success ? 1 : 0)
  const failureCount = existing.failureCount + (args.success ? 0 : 1)
  await db
    .update(schema.recoveryStrategyStats)
    .set({
      attemptCount,
      successCount,
      failureCount,
      successRate: round(successCount / attemptCount, 4),
      lastOutcome: args.outcome,
      updatedAt: args.now,
    })
    .where(eq(schema.recoveryStrategyStats.id, existing.id))

  const updated = await db.query.recoveryStrategyStats.findFirst({
    where: eq(schema.recoveryStrategyStats.id, existing.id),
  })
  if (!updated) throw new Error(`Recovery strategy stats missing after update: ${existing.id}`)
  return updated
}

function bestStatsForStrategy(
  statsRows: RecoveryStrategyStatsRow[],
  strategyType: RecoveryStrategyType,
  agentProfileId: string | null,
): RecoveryStrategyStatsRow | undefined {
  const candidates = statsRows.filter((row) => row.strategyType === strategyType)
  const agentSpecific = candidates.find((row) => (row.agentProfileId ?? null) === agentProfileId)
  if (agentSpecific) return agentSpecific
  return candidates.find((row) => row.agentProfileId === null)
}

async function getRequiredClassification(id: string): Promise<ErrorClassificationRow> {
  const row = await db.query.errorClassifications.findFirst({
    where: eq(schema.errorClassifications.id, normalizeRequired(id, 'classificationId')),
  })
  if (!row) throw new Error(`Error classification not found: ${id}`)
  return row
}

async function assertAgentExists(agentProfileId: string | null): Promise<void> {
  if (!agentProfileId) return
  const agent = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, agentProfileId),
  })
  if (!agent) throw new Error(`Agent profile not found: ${agentProfileId}`)
}

function detectCategory(normalized: string): ErrorTaxonomyCategory {
  if (matches(normalized, ['rate limit', 'ratelimit', '429', 'too many requests', 'quota exceeded'])) {
    return 'rate_limit_error'
  }
  if (matches(normalized, ['timeout', 'timed out', 'deadline exceeded', 'etimedout'])) {
    return 'timeout_error'
  }
  if (matches(normalized, ['permission', 'access denied', 'forbidden', 'unauthorized', 'approval required', 'sandbox'])) {
    return 'permission_error'
  }
  if (matches(normalized, ['dns', 'enotfound', 'econnreset', 'network', 'socket', 'proxy', 'connect failed'])) {
    return 'network_error'
  }
  if (matches(normalized, ['model', 'llm', 'openai', 'anthropic', 'context window', 'token limit', 'provider'])) {
    return 'model_error'
  }
  if (matches(normalized, ['lock', 'busy', 'conflict', 'resource', 'out of memory', 'disk full', 'quota'])) {
    return 'resource_error'
  }
  if (matches(normalized, ['invalid input', 'validation', 'schema', 'missing required', 'parse error', 'bad request'])) {
    return 'input_error'
  }
  if (matches(normalized, ['env', 'environment', 'executable not found', 'command not found', 'no such file', 'path not found', 'docker'])) {
    return 'environment_error'
  }
  return 'tool_error'
}

function detectSeverity(category: ErrorTaxonomyCategory, normalized: string): ErrorSeverity {
  if (matches(normalized, ['fatal', 'corruption', 'data loss', 'security violation', 'malware', 'payment submitted'])) {
    return 'fatal'
  }
  if (category === 'permission_error' || category === 'input_error') return 'recoverable_with_help'
  if (category === 'environment_error' && matches(normalized, ['missing', 'not found', 'not installed'])) {
    return 'recoverable_with_help'
  }
  return 'recoverable'
}

function strategyCandidates(
  category: ErrorTaxonomyCategory,
  severity: ErrorSeverity,
  context: JsonObject,
): RecoveryStrategyCandidate[] {
  if (severity === 'fatal') {
    return [
      candidate('ask_user', { message: 'A fatal error needs human decision before continuing.' }, 0.8, 'Fatal errors must stop autonomous execution and ask the user.'),
      candidate('rollback', { toCheckpointId: getString(context, 'checkpointId') ?? 'latest_safe_checkpoint' }, 0.66, 'Rollback is safer than continuing after a fatal state.'),
      candidate('delegate_to_agent', { agentId: getString(context, 'fallbackAgentId') ?? 'select_peer_agent' }, 0.45, 'Delegation is only a fallback after the user reviews risk.'),
    ]
  }

  switch (category) {
    case 'model_error':
      return [
        candidate('retry_with_fallback_model', {}, 0.72, 'Model/provider failures often recover by switching to a configured fallback model.'),
        candidate('retry', { maxRetries: 2, backoffMs: 1500 }, 0.62, 'Transient model errors can recover with a bounded retry.'),
        candidate('replan_from_scratch', {}, 0.52, 'If model output is structurally broken, rebuild the plan from a clean context.'),
        candidate('ask_user', { message: 'Model provider failure needs a model or credential decision.' }, 0.4, 'Ask the user when credentials, billing, or model choice are unclear.'),
      ]
    case 'tool_error':
      return [
        candidate('retry_with_different_approach', { hint: 'Use a different tool, smaller input, or manual verification.' }, 0.68, 'Tool failures often need a different route rather than repeating the same call.'),
        candidate('retry', { maxRetries: 2, backoffMs: 1000 }, 0.58, 'Short retries handle transient tool failures.'),
        candidate('skip_step', { condition: 'Only if the output contract can still be satisfied.' }, 0.42, 'Skipping is allowed only when verification still passes.'),
        candidate('ask_user', { message: 'Tool failure needs user guidance or approval for an alternate action.' }, 0.38, 'Ask the user before risky alternate tool usage.'),
      ]
    case 'network_error':
      return [
        candidate('retry', { maxRetries: 3, backoffMs: 2000 }, 0.7, 'Network errors are usually transient and benefit from exponential backoff.'),
        candidate('retry_with_different_approach', { hint: 'Switch network profile/proxy or use cached/local data.' }, 0.62, 'A different network route or offline source can avoid a bad outlet.'),
        candidate('ask_user', { message: 'Network access is unavailable; choose another outlet or continue offline.' }, 0.42, 'Ask when the network route itself needs a human decision.'),
      ]
    case 'permission_error':
      return [
        candidate('ask_user', { message: 'Permission or approval is required before continuing.' }, 0.76, 'Permission errors should pause and ask for approval or scope changes.'),
        candidate('retry_with_different_approach', { hint: 'Use an allowed directory/tool/action instead.' }, 0.55, 'A lower-risk allowed route may complete the task.'),
        candidate('replan_from_scratch', {}, 0.45, 'Replanning can remove disallowed actions from the path.'),
      ]
    case 'resource_error':
      return [
        candidate('retry', { maxRetries: 4, backoffMs: 3000 }, 0.66, 'Busy locks and resource contention often clear with waiting.'),
        candidate('delegate_to_agent', { agentId: getString(context, 'fallbackAgentId') ?? 'select_peer_agent' }, 0.58, 'Delegation can move work to another Agent/workstation.'),
        candidate('skip_step', { condition: 'Only when the resource is optional and verification remains valid.' }, 0.36, 'Optional resource usage can sometimes be skipped.'),
        candidate('ask_user', { message: 'The required resource is unavailable or locked.' }, 0.34, 'Ask the user if the resource needs manual release.'),
      ]
    case 'input_error':
      return [
        candidate('ask_user', { message: 'Input is missing or invalid; provide corrected input.' }, 0.74, 'Invalid input usually requires clarification or correction.'),
        candidate('replan_from_scratch', {}, 0.5, 'Replanning can adapt to partial or corrected input.'),
        candidate('retry_with_different_approach', { hint: 'Validate and coerce the input schema before retrying.' }, 0.46, 'Schema repair can unblock low-risk input mismatches.'),
      ]
    case 'environment_error':
      return [
        candidate('retry_with_different_approach', { hint: 'Check paths, executable availability, environment variables, or use a configured adapter.' }, 0.63, 'Environment failures usually need a corrected path/tooling route.'),
        candidate('ask_user', { message: 'Local environment setup is missing or unavailable.' }, 0.56, 'Ask when installation or machine setup is needed.'),
        candidate('replan_from_scratch', {}, 0.44, 'A fresh plan may avoid unavailable local dependencies.'),
      ]
    case 'rate_limit_error':
      return [
        candidate('retry', { maxRetries: 3, backoffMs: 8000 }, 0.7, 'Rate limits require waiting before retrying.'),
        candidate('retry_with_fallback_model', {}, 0.64, 'Fallback model/provider can bypass one provider limit.'),
        candidate('replan_from_scratch', {}, 0.38, 'Replanning can reduce calls or batch work.'),
        candidate('ask_user', { message: 'Rate limit reached; approve fallback provider or wait.' }, 0.36, 'Ask when fallback may affect cost or provider choice.'),
      ]
    case 'timeout_error':
      return [
        candidate('retry', { maxRetries: 2, backoffMs: 2500 }, 0.67, 'Timeouts are often transient or caused by long-running operations.'),
        candidate('retry_with_different_approach', { hint: 'Split the operation into smaller chunks or use a faster adapter.' }, 0.63, 'Changing the approach can avoid repeated timeouts.'),
        candidate('delegate_to_agent', { agentId: getString(context, 'fallbackAgentId') ?? 'select_peer_agent' }, 0.42, 'A different workstation or Agent may finish a long task.'),
      ]
  }
}

function candidate(
  strategyType: RecoveryStrategyType,
  strategyConfig: JsonObject,
  priorSuccessRate: number,
  reason: string,
): RecoveryStrategyCandidate {
  return { strategyType, strategyConfig, priorSuccessRate, reason }
}

function fallbackRanking(category: ErrorTaxonomyCategory, severity: ErrorSeverity): JsonObject {
  const strategyType: RecoveryStrategyType = severity === 'fatal' ? 'ask_user' : 'retry'
  return {
    strategyType,
    strategyConfig: strategyType === 'retry' ? { maxRetries: 1, backoffMs: 1000 } : { message: 'User review required.' },
    reason: `Fallback recovery strategy for ${severity} ${category}.`,
    historicalAttemptCount: 0,
    historicalSuccessRate: null,
    priorSuccessRate: 0.4,
    score: 0.4,
  }
}

function strategyPriority(strategyType: RecoveryStrategyType): number {
  return [
    'retry',
    'retry_with_fallback_model',
    'retry_with_different_approach',
    'ask_user',
    'replan_from_scratch',
    'delegate_to_agent',
    'skip_step',
    'rollback',
  ].indexOf(strategyType)
}

function normalizeErrorText(message: string, context: JsonObject): string {
  return `${message} ${JSON.stringify(context)}`.normalize('NFKC').toLowerCase()
}

function confidenceForCategory(category: ErrorTaxonomyCategory, normalized: string): number {
  const strongSignals: Record<ErrorTaxonomyCategory, string[]> = {
    model_error: ['model', 'llm', 'provider', 'context window'],
    tool_error: ['tool', 'mcp', 'cli', 'command', 'browser'],
    network_error: ['network', 'dns', 'econnreset', 'proxy'],
    permission_error: ['permission', 'denied', 'forbidden', 'approval', 'sandbox'],
    resource_error: ['lock', 'busy', 'resource', 'memory', 'disk'],
    input_error: ['invalid input', 'schema', 'validation', 'missing required'],
    environment_error: ['environment', 'executable', 'command not found', 'path not found'],
    rate_limit_error: ['rate limit', '429', 'quota'],
    timeout_error: ['timeout', 'timed out', 'deadline'],
  }
  const signalCount = strongSignals[category].filter((signal) => normalized.includes(signal)).length
  return round(Math.min(0.95, 0.55 + signalCount * 0.12), 2)
}

function matches(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle))
}

function normalizeRequired(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? 100)) return 100
  return Math.min(Math.max(Math.floor(limit ?? 100), 1), 500)
}

function getString(value: JsonObject, key: string): string | null {
  const next = value[key]
  return typeof next === 'string' && next.trim() ? next.trim() : null
}

function getNumber(value: JsonObject, key: string): number {
  const next = value[key]
  return typeof next === 'number' && Number.isFinite(next) ? next : 0
}

function asJsonObject(value: unknown): JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function round(value: number, places = 4): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}
