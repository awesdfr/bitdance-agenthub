import { createHash } from 'node:crypto'

import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  ModelCacheEvaluationStatus,
  ModelCacheStrategy,
  ModelInvocationOptimizationEventRow,
  ModelInvocationOptimizationPolicy,
  ModelInvocationOptimizationPolicyRow,
  ModelInvocationTaskType,
  ModelOptimizationEventType,
  ModelParameterValues,
  ModelResponseCacheEntryRow,
  ModelWarmupSessionRow,
  ModelWarmupStatus,
} from '@/db/schema'
import {
  newModelInvocationOptimizationEventId,
  newModelInvocationOptimizationPolicyId,
  newModelResponseCacheEntryId,
  newModelWarmupSessionId,
} from '@/server/ids'

export interface CreateModelInvocationOptimizationPolicyArgs {
  name?: string
  status?: ModelInvocationOptimizationPolicyRow['status']
  policy?: PartialModelInvocationOptimizationPolicy
}

export interface EvaluateModelResponseCacheArgs {
  policyId?: string
  modelProfileId?: string | null
  agentProfileId?: string | null
  taskType: ModelInvocationTaskType
  input: JsonObject
  output?: JsonObject
  costCents?: number
  now?: number
}

export interface ModelResponseCacheEvaluationResult {
  policy: ModelInvocationOptimizationPolicyRow
  status: ModelCacheEvaluationStatus
  entry: ModelResponseCacheEntryRow | null
  event: ModelInvocationOptimizationEventRow
  cacheKey: string
  semanticKey: string
  reason: string
}

export interface ResolveModelParametersArgs {
  policyId?: string
  agentProfileId?: string | null
  taskType: ModelInvocationTaskType
}

export interface ResolveModelParametersResult {
  policy: ModelInvocationOptimizationPolicyRow
  taskType: ModelInvocationTaskType
  parameters: ModelParameterValues
  source: 'agent_override' | 'task_default' | 'fallback'
  event: ModelInvocationOptimizationEventRow
}

export interface StartModelWarmupArgs {
  policyId?: string
  agentProfileId?: string | null
  modelProfileId?: string | null
}

export interface CompleteModelWarmupArgs {
  success: boolean
  latencyMs?: number
  message?: string
}

type PartialModelInvocationOptimizationPolicy = {
  responseCache?: Partial<Omit<ModelInvocationOptimizationPolicy['responseCache'], 'stats'>> & {
    stats?: Partial<ModelInvocationOptimizationPolicy['responseCache']['stats']>
  }
  parameters?: {
    byTaskType?: Partial<Record<ModelInvocationTaskType, ModelParameterValues>>
    agentOverrides?: Record<string, Partial<Record<ModelInvocationTaskType, ModelParameterValues>>>
  }
  warmup?: Partial<Omit<ModelInvocationOptimizationPolicy['warmup'], 'connectionPool'>> & {
    connectionPool?: Partial<ModelInvocationOptimizationPolicy['warmup']['connectionPool']>
  }
}

const DEFAULT_POLICY_NAME = 'Default model invocation optimization policy'

const defaultParameters: Record<ModelInvocationTaskType, ModelParameterValues> = {
  code_generation: { temperature: 0.1, topP: 0.95 },
  creative_writing: { temperature: 0.9, topP: 0.98 },
  analysis: { temperature: 0.3, topP: 0.9 },
  planning: { temperature: 0.5, topP: 0.95 },
  tool_selection: { temperature: 0, topP: 1 },
  summarization: { temperature: 0.2, topP: 0.9 },
  task_planning: { temperature: 0.5, topP: 0.95 },
  creative_generation: { temperature: 0.9, topP: 0.98 },
  safety_critical: { temperature: 0, topP: 1 },
  other: { temperature: 0.3, topP: 0.9 },
}

const defaultPolicy: ModelInvocationOptimizationPolicy = {
  responseCache: {
    strategy: 'exact',
    exactTTL: 60,
    semanticTTL: 300,
    similarityThreshold: 0.97,
    noCacheFor: ['task_planning', 'creative_generation', 'safety_critical'],
    stats: { hits: 0, misses: 0, savedCost: 0 },
  },
  parameters: {
    byTaskType: defaultParameters,
    agentOverrides: {},
  },
  warmup: {
    autoWarmupAfterAgentCreated: true,
    warmupRequest: 'count one token',
    cacheConnection: true,
    displayStatus: 'Agent is warming...',
    connectionPool: {
      keepHttp2Alive: true,
      avoidRepeatedTlsHandshake: true,
      maxIdleMs: 300000,
    },
  },
}

export async function seedModelInvocationOptimizationPolicy(): Promise<ModelInvocationOptimizationPolicyRow> {
  const existing = await db.query.modelInvocationOptimizationPolicies.findFirst({
    where: eq(schema.modelInvocationOptimizationPolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  const now = Date.now()
  const row: ModelInvocationOptimizationPolicyRow = {
    id: newModelInvocationOptimizationPolicyId(),
    name: DEFAULT_POLICY_NAME,
    policy: defaultPolicy,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.modelInvocationOptimizationPolicies).values(row)
  return row
}

export async function createModelInvocationOptimizationPolicy(
  args: CreateModelInvocationOptimizationPolicyArgs = {},
): Promise<ModelInvocationOptimizationPolicyRow> {
  const now = Date.now()
  const row: ModelInvocationOptimizationPolicyRow = {
    id: newModelInvocationOptimizationPolicyId(),
    name: args.name ?? `Model invocation optimization ${new Date(now).toISOString()}`,
    policy: mergePolicy(args.policy),
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.modelInvocationOptimizationPolicies).values(row)
  return row
}

export async function listModelInvocationOptimizationPolicies(args: {
  status?: ModelInvocationOptimizationPolicyRow['status']
  limit?: number
} = {}): Promise<ModelInvocationOptimizationPolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.modelInvocationOptimizationPolicies.status, args.status))
  return db.query.modelInvocationOptimizationPolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.modelInvocationOptimizationPolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function evaluateModelResponseCache(
  args: EvaluateModelResponseCacheArgs,
): Promise<ModelResponseCacheEvaluationResult> {
  const policy = args.policyId
    ? await getRequiredPolicy(args.policyId)
    : await seedModelInvocationOptimizationPolicy()
  if (policy.status !== 'active') throw new Error(`Model optimization policy is ${policy.status}: ${policy.id}`)

  const now = args.now ?? Date.now()
  const cache = policy.policy.responseCache
  const cacheKey = hashInput(args.input)
  const semanticKey = buildSemanticKey(args.input)
  const bypassReason = cacheBypassReason(cache.strategy, args.taskType, cache.noCacheFor)
  if (bypassReason) {
    const event = await recordEvent(policy.id, 'cache_bypass', args.taskType, 'bypassed', {
      reason: bypassReason,
      cacheKey,
      semanticKey,
    })
    return { policy, status: 'bypassed', entry: null, event, cacheKey, semanticKey, reason: bypassReason }
  }

  const exact = await findExactEntry(policy.id, cacheKey, now)
  if (exact) return cacheHit(policy, exact, args.taskType, cacheKey, semanticKey, 'Exact cache hit.')

  if (cache.strategy === 'semantic') {
    const semantic = await findSemanticEntry(policy.id, semanticKey, args.input, cache.similarityThreshold, now)
    if (semantic) {
      return cacheHit(policy, semantic, args.taskType, cacheKey, semanticKey, 'Semantic cache hit.')
    }
  }

  if (args.output) {
    const entry = await storeCacheEntry(policy, args, cache.strategy, cacheKey, semanticKey, now)
    const updatedPolicy = await updateCacheStats(policy, { misses: 1, hits: 0, savedCost: 0 })
    const event = await recordEvent(policy.id, 'cache_miss', args.taskType, 'miss_stored', {
      cacheKey,
      semanticKey,
      entryId: entry.id,
      reason: 'Cache miss; stored supplied output for future reuse.',
    })
    return {
      policy: updatedPolicy,
      status: 'miss_stored',
      entry,
      event,
      cacheKey,
      semanticKey,
      reason: 'Cache miss; stored supplied output for future reuse.',
    }
  }

  const updatedPolicy = await updateCacheStats(policy, { misses: 1, hits: 0, savedCost: 0 })
  const event = await recordEvent(policy.id, 'cache_miss', args.taskType, 'miss', {
    cacheKey,
    semanticKey,
    reason: 'Cache miss; no output was supplied to store.',
  })
  return {
    policy: updatedPolicy,
    status: 'miss',
    entry: null,
    event,
    cacheKey,
    semanticKey,
    reason: 'Cache miss; no output was supplied to store.',
  }
}

export async function listModelResponseCacheEntries(args: {
  policyId?: string
  modelProfileId?: string
  taskType?: ModelInvocationTaskType
  limit?: number
} = {}): Promise<ModelResponseCacheEntryRow[]> {
  const filters: SQL[] = []
  if (args.policyId) filters.push(eq(schema.modelResponseCacheEntries.policyId, args.policyId))
  if (args.modelProfileId) filters.push(eq(schema.modelResponseCacheEntries.modelProfileId, args.modelProfileId))
  if (args.taskType) filters.push(eq(schema.modelResponseCacheEntries.taskType, args.taskType))
  return db.query.modelResponseCacheEntries.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.modelResponseCacheEntries.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function resolveModelParameters(
  args: ResolveModelParametersArgs,
): Promise<ResolveModelParametersResult> {
  const policy = args.policyId
    ? await getRequiredPolicy(args.policyId)
    : await seedModelInvocationOptimizationPolicy()
  if (policy.status !== 'active') throw new Error(`Model optimization policy is ${policy.status}: ${policy.id}`)

  const override = args.agentProfileId
    ? policy.policy.parameters.agentOverrides?.[args.agentProfileId]?.[args.taskType]
    : undefined
  const taskDefault = policy.policy.parameters.byTaskType[args.taskType]
  const fallback = policy.policy.parameters.byTaskType.other
  const parameters = override ?? taskDefault ?? fallback
  const source = override ? 'agent_override' : taskDefault ? 'task_default' : 'fallback'
  const event = await recordEvent(policy.id, 'parameters_resolved', args.taskType, source, {
    agentProfileId: args.agentProfileId ?? null,
    parameters,
  })
  return { policy, taskType: args.taskType, parameters, source, event }
}

export async function startModelWarmup(args: StartModelWarmupArgs): Promise<ModelWarmupSessionRow> {
  const policy = args.policyId
    ? await getRequiredPolicy(args.policyId)
    : await seedModelInvocationOptimizationPolicy()
  if (policy.status !== 'active') throw new Error(`Model optimization policy is ${policy.status}: ${policy.id}`)
  const now = Date.now()
  const session: ModelWarmupSessionRow = {
    id: newModelWarmupSessionId(),
    policyId: policy.id,
    agentProfileId: args.agentProfileId ?? null,
    modelProfileId: args.modelProfileId ?? null,
    status: 'warming',
    warmupRequest: policy.policy.warmup.warmupRequest,
    displayStatus: policy.policy.warmup.displayStatus,
    connectionPoolPlan: {
      ...policy.policy.warmup.connectionPool,
      cacheConnection: policy.policy.warmup.cacheConnection,
      recordOnly: true,
    },
    result: {},
    createdAt: now,
    completedAt: null,
  }
  await db.insert(schema.modelWarmupSessions).values(session)
  await recordEvent(policy.id, 'warmup_started', 'other', 'warming', {
    sessionId: session.id,
    agentProfileId: session.agentProfileId,
    modelProfileId: session.modelProfileId,
    displayStatus: session.displayStatus,
  })
  return session
}

export async function completeModelWarmup(
  warmupSessionId: string,
  args: CompleteModelWarmupArgs,
): Promise<ModelWarmupSessionRow> {
  const existing = await db.query.modelWarmupSessions.findFirst({
    where: eq(schema.modelWarmupSessions.id, warmupSessionId),
  })
  if (!existing) throw new Error(`Model warmup session not found: ${warmupSessionId}`)
  const now = Date.now()
  const status: ModelWarmupStatus = args.success ? 'warmed' : 'failed'
  const result: JsonObject = {
    success: args.success,
    latencyMs: args.latencyMs ?? null,
    message: args.message ?? '',
    connectionCached: args.success,
    recordOnly: true,
  }
  await db
    .update(schema.modelWarmupSessions)
    .set({ status, result, completedAt: now })
    .where(eq(schema.modelWarmupSessions.id, warmupSessionId))
  await recordEvent(existing.policyId, 'warmup_completed', 'other', status, {
    sessionId: existing.id,
    result,
  })
  return {
    ...existing,
    status,
    result,
    completedAt: now,
  }
}

export async function listModelWarmupSessions(args: {
  agentProfileId?: string
  status?: ModelWarmupStatus
  limit?: number
} = {}): Promise<ModelWarmupSessionRow[]> {
  const filters: SQL[] = []
  if (args.agentProfileId) filters.push(eq(schema.modelWarmupSessions.agentProfileId, args.agentProfileId))
  if (args.status) filters.push(eq(schema.modelWarmupSessions.status, args.status))
  return db.query.modelWarmupSessions.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.modelWarmupSessions.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function listModelInvocationOptimizationEvents(args: {
  policyId?: string
  eventType?: ModelOptimizationEventType
  limit?: number
} = {}): Promise<ModelInvocationOptimizationEventRow[]> {
  const filters: SQL[] = []
  if (args.policyId) filters.push(eq(schema.modelInvocationOptimizationEvents.policyId, args.policyId))
  if (args.eventType) filters.push(eq(schema.modelInvocationOptimizationEvents.eventType, args.eventType))
  return db.query.modelInvocationOptimizationEvents.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.modelInvocationOptimizationEvents.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

function mergePolicy(
  patch: PartialModelInvocationOptimizationPolicy | undefined,
): ModelInvocationOptimizationPolicy {
  return {
    responseCache: {
      ...defaultPolicy.responseCache,
      ...patch?.responseCache,
      stats: {
        ...defaultPolicy.responseCache.stats,
        ...patch?.responseCache?.stats,
      },
      noCacheFor: patch?.responseCache?.noCacheFor ?? defaultPolicy.responseCache.noCacheFor,
    },
    parameters: {
      byTaskType: {
        ...defaultPolicy.parameters.byTaskType,
        ...patch?.parameters?.byTaskType,
      },
      agentOverrides: patch?.parameters?.agentOverrides ?? {},
    },
    warmup: {
      ...defaultPolicy.warmup,
      ...patch?.warmup,
      connectionPool: {
        ...defaultPolicy.warmup.connectionPool,
        ...patch?.warmup?.connectionPool,
      },
    },
  }
}

function cacheBypassReason(
  strategy: ModelCacheStrategy,
  taskType: ModelInvocationTaskType,
  noCacheFor: ModelInvocationTaskType[],
): string {
  if (strategy === 'none') return 'Response cache strategy is none.'
  if (noCacheFor.includes(taskType)) return `Task type ${taskType} must stay fresh and is not cached.`
  return ''
}

async function findExactEntry(
  policyId: string,
  inputHash: string,
  now: number,
): Promise<ModelResponseCacheEntryRow | null> {
  const rows = await db.query.modelResponseCacheEntries.findMany({
    where: and(
      eq(schema.modelResponseCacheEntries.policyId, policyId),
      eq(schema.modelResponseCacheEntries.inputHash, inputHash),
    ),
    orderBy: [desc(schema.modelResponseCacheEntries.updatedAt)],
    limit: 20,
  })
  return rows.find((row) => row.expiresAt > now) ?? null
}

async function findSemanticEntry(
  policyId: string,
  semanticKey: string,
  input: JsonObject,
  threshold: number,
  now: number,
): Promise<ModelResponseCacheEntryRow | null> {
  const rows = await db.query.modelResponseCacheEntries.findMany({
    where: eq(schema.modelResponseCacheEntries.policyId, policyId),
    orderBy: [desc(schema.modelResponseCacheEntries.updatedAt)],
    limit: 50,
  })
  const inputTokens = tokenSet(semanticKey)
  return rows.find((row) => {
    if (row.expiresAt <= now) return false
    const score = jaccard(inputTokens, tokenSet(row.semanticKey || buildSemanticKey(input)))
    return score >= threshold
  }) ?? null
}

async function cacheHit(
  policy: ModelInvocationOptimizationPolicyRow,
  entry: ModelResponseCacheEntryRow,
  taskType: ModelInvocationTaskType,
  cacheKey: string,
  semanticKey: string,
  reason: string,
): Promise<ModelResponseCacheEvaluationResult> {
  const now = Date.now()
  await db
    .update(schema.modelResponseCacheEntries)
    .set({ hitCount: entry.hitCount + 1, updatedAt: now })
    .where(eq(schema.modelResponseCacheEntries.id, entry.id))
  const updatedEntry = { ...entry, hitCount: entry.hitCount + 1, updatedAt: now }
  const updatedPolicy = await updateCacheStats(policy, {
    hits: 1,
    misses: 0,
    savedCost: entry.costCents,
  })
  const event = await recordEvent(policy.id, 'cache_hit', taskType, 'hit', {
    entryId: entry.id,
    cacheKey,
    semanticKey,
    savedCost: entry.costCents,
    reason,
  })
  return { policy: updatedPolicy, status: 'hit', entry: updatedEntry, event, cacheKey, semanticKey, reason }
}

async function storeCacheEntry(
  policy: ModelInvocationOptimizationPolicyRow,
  args: EvaluateModelResponseCacheArgs,
  strategy: ModelCacheStrategy,
  cacheKey: string,
  semanticKey: string,
  now: number,
): Promise<ModelResponseCacheEntryRow> {
  const ttlSeconds =
    strategy === 'semantic'
      ? policy.policy.responseCache.semanticTTL
      : policy.policy.responseCache.exactTTL
  const row: ModelResponseCacheEntryRow = {
    id: newModelResponseCacheEntryId(),
    policyId: policy.id,
    modelProfileId: args.modelProfileId ?? null,
    agentProfileId: args.agentProfileId ?? null,
    taskType: args.taskType,
    strategy,
    inputHash: cacheKey,
    semanticKey,
    inputSummary: summarizeInput(args.input),
    output: args.output ?? {},
    costCents: Math.max(args.costCents ?? 0, 0),
    hitCount: 0,
    expiresAt: now + ttlSeconds * 1000,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.modelResponseCacheEntries).values(row)
  return row
}

async function updateCacheStats(
  policy: ModelInvocationOptimizationPolicyRow,
  delta: { hits: number; misses: number; savedCost: number },
): Promise<ModelInvocationOptimizationPolicyRow> {
  const stats = policy.policy.responseCache.stats
  const nextPolicy: ModelInvocationOptimizationPolicy = {
    ...policy.policy,
    responseCache: {
      ...policy.policy.responseCache,
      stats: {
        hits: stats.hits + delta.hits,
        misses: stats.misses + delta.misses,
        savedCost: stats.savedCost + delta.savedCost,
      },
    },
  }
  const updatedAt = Date.now()
  await db
    .update(schema.modelInvocationOptimizationPolicies)
    .set({ policy: nextPolicy, updatedAt })
    .where(eq(schema.modelInvocationOptimizationPolicies.id, policy.id))
  return { ...policy, policy: nextPolicy, updatedAt }
}

async function recordEvent(
  policyId: string | null,
  eventType: ModelOptimizationEventType,
  taskType: ModelInvocationTaskType,
  status: string,
  details: JsonObject,
): Promise<ModelInvocationOptimizationEventRow> {
  const row: ModelInvocationOptimizationEventRow = {
    id: newModelInvocationOptimizationEventId(),
    policyId,
    eventType,
    taskType,
    status,
    details,
    createdAt: Date.now(),
  }
  await db.insert(schema.modelInvocationOptimizationEvents).values(row)
  return row
}

function hashInput(input: JsonObject): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function buildSemanticKey(input: JsonObject): string {
  return Object.values(input)
    .flatMap((value) => String(value).toLowerCase().match(/[a-z0-9\u4e00-\u9fff]+/g) ?? [])
    .slice(0, 80)
    .join(' ')
}

function summarizeInput(input: JsonObject): string {
  const raw = stableStringify(input)
  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw
}

function tokenSet(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter(Boolean))
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size && !right.size) return 1
  const intersection = [...left].filter((token) => right.has(token)).length
  const union = new Set([...left, ...right]).size
  return union ? intersection / union : 0
}

async function getRequiredPolicy(id: string): Promise<ModelInvocationOptimizationPolicyRow> {
  const row = await db.query.modelInvocationOptimizationPolicies.findFirst({
    where: eq(schema.modelInvocationOptimizationPolicies.id, id),
  })
  if (!row) throw new Error(`Model invocation optimization policy not found: ${id}`)
  return row
}
