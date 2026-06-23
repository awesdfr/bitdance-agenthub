import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  TelemetryDecision,
  TelemetryDecisionStatus,
  TelemetryEventInput,
  TelemetryEventRow,
  TelemetryExportManifestRow,
  TelemetryLevel,
  TelemetryNeverCollectCategory,
  TelemetryPolicy,
  TelemetryPolicyRow,
} from '@/db/schema'
import {
  newTelemetryEventId,
  newTelemetryExportManifestId,
  newTelemetryPolicyId,
} from '@/server/ids'

export interface CreateTelemetryPolicyArgs {
  name?: string
  level?: TelemetryLevel
  consentGranted?: boolean
  status?: TelemetryPolicyRow['status']
  minimal?: Partial<TelemetryPolicy['minimal']>
  usage?: Partial<TelemetryPolicy['usage']>
  performance?: Partial<TelemetryPolicy['performance']>
  full?: Partial<TelemetryPolicy['full']>
  neverCollect?: TelemetryNeverCollectCategory[]
  exportable?: boolean
}

export interface EvaluateTelemetryEventArgs extends TelemetryEventInput {
  policyId?: string
}

export interface TelemetryEvaluationResult {
  policy: TelemetryPolicyRow
  event: TelemetryEventRow
  decision: TelemetryDecision
  summary: {
    status: TelemetryDecisionStatus
    allowedFieldCount: number
    redactedFieldCount: number
    blockedFieldCount: number
    neverCollect: TelemetryNeverCollectCategory[]
  }
}

export interface TelemetryExportArgs {
  policyId?: string
  status?: TelemetryDecisionStatus
  eventType?: string
  limit?: number
}

const DEFAULT_POLICY_NAME = 'Default explicit-consent telemetry policy'

export const TELEMETRY_NEVER_COLLECT: TelemetryNeverCollectCategory[] = [
  'api_keys',
  'user_files',
  'agent_outputs',
  'memory_content',
  'browser_screenshots',
  'clipboard_data',
  'credentials',
]

const defaultPolicy: TelemetryPolicy = {
  level: 'off',
  requiresExplicitConsent: true,
  defaultOptIn: false,
  consentGranted: false,
  minimal: {
    appVersion: 'local-dev',
    os: 'unknown',
    anonymousInstallId: 'local-anonymous-install',
    crashReports: false,
  },
  usage: {
    agentsCreated: 0,
    tasksRun: 0,
    workflowsCreated: 0,
  },
  performance: {
    avgTaskDuration: 0,
    modelLatency: 0,
  },
  full: {
    errorTraces: false,
  },
  neverCollect: TELEMETRY_NEVER_COLLECT,
  exportable: true,
}

const levelRank: Record<TelemetryLevel, number> = {
  off: 0,
  minimal: 1,
  usage: 2,
  performance: 3,
  full: 4,
}

const scopedKeys: Record<Exclude<TelemetryLevel, 'off' | 'full'>, string[]> = {
  minimal: ['appVersion', 'os', 'anonymousInstallId', 'crashReports'],
  usage: [
    'appVersion',
    'os',
    'anonymousInstallId',
    'crashReports',
    'agentsCreated',
    'tasksRun',
    'workflowsCreated',
  ],
  performance: [
    'appVersion',
    'os',
    'anonymousInstallId',
    'crashReports',
    'agentsCreated',
    'tasksRun',
    'workflowsCreated',
    'avgTaskDuration',
    'modelLatency',
  ],
}

const sensitiveKeyPatterns: Array<{ category: TelemetryNeverCollectCategory; pattern: RegExp }> = [
  { category: 'api_keys', pattern: /api[_-]?key|openai.*key|anthropic.*key|deepseek.*key/i },
  { category: 'credentials', pattern: /credential|password|secret|token|auth/i },
  { category: 'user_files', pattern: /user[_-]?file|file(content|path|body)|attachment|documentContent/i },
  { category: 'agent_outputs', pattern: /agent[_-]?output|artifactContent|finalOutput/i },
  { category: 'memory_content', pattern: /memory(Content|Item|Text)|longTermMemory/i },
  { category: 'browser_screenshots', pattern: /screenshot|screenCapture|browserImage/i },
  { category: 'clipboard_data', pattern: /clipboard/i },
]

export async function seedTelemetryPolicy(): Promise<TelemetryPolicyRow> {
  const existing = await db.query.telemetryPolicies.findFirst({
    where: eq(schema.telemetryPolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  const now = Date.now()
  const row: TelemetryPolicyRow = {
    id: newTelemetryPolicyId(),
    name: DEFAULT_POLICY_NAME,
    policy: defaultPolicy,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.telemetryPolicies).values(row)
  return row
}

export async function createTelemetryPolicy(
  args: CreateTelemetryPolicyArgs = {},
): Promise<TelemetryPolicyRow> {
  const now = Date.now()
  const row: TelemetryPolicyRow = {
    id: newTelemetryPolicyId(),
    name: args.name ?? `Telemetry policy ${new Date(now).toISOString()}`,
    policy: mergePolicy(args),
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.telemetryPolicies).values(row)
  return row
}

export async function listTelemetryPolicies(args: {
  status?: TelemetryPolicyRow['status']
  limit?: number
} = {}): Promise<TelemetryPolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.telemetryPolicies.status, args.status))
  return db.query.telemetryPolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.telemetryPolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function evaluateTelemetryEvent(
  args: EvaluateTelemetryEventArgs,
): Promise<TelemetryEvaluationResult> {
  const policy = args.policyId ? await getRequiredPolicy(args.policyId) : await seedTelemetryPolicy()
  if (policy.status !== 'active') throw new Error(`Telemetry policy is ${policy.status}: ${policy.id}`)

  const input = normalizeInput(args)
  const decision = decideTelemetry(policy.policy, input)
  const event: TelemetryEventRow = {
    id: newTelemetryEventId(),
    policyId: policy.id,
    requestedLevel: input.level,
    eventType: input.eventType,
    input,
    decision,
    sanitizedPayload: decision.allowedPayload,
    status: decision.status,
    blockedFields: decision.blockedFields,
    redactedFields: decision.redactedFields,
    reason: decision.reason,
    createdAt: Date.now(),
  }
  await db.insert(schema.telemetryEvents).values(event)
  return {
    policy,
    event,
    decision,
    summary: {
      status: decision.status,
      allowedFieldCount: Object.keys(decision.allowedPayload).length,
      redactedFieldCount: decision.redactedFields.length,
      blockedFieldCount: decision.blockedFields.length,
      neverCollect: policy.policy.neverCollect,
    },
  }
}

export async function listTelemetryEvents(args: {
  policyId?: string
  status?: TelemetryDecisionStatus
  eventType?: string
  limit?: number
} = {}): Promise<TelemetryEventRow[]> {
  const filters: SQL[] = []
  if (args.policyId) filters.push(eq(schema.telemetryEvents.policyId, args.policyId))
  if (args.status) filters.push(eq(schema.telemetryEvents.status, args.status))
  if (args.eventType) filters.push(eq(schema.telemetryEvents.eventType, args.eventType))
  return db.query.telemetryEvents.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.telemetryEvents.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function exportTelemetryData(
  args: TelemetryExportArgs = {},
): Promise<TelemetryExportManifestRow> {
  const policy = args.policyId ? await getRequiredPolicy(args.policyId) : await seedTelemetryPolicy()
  if (!policy.policy.exportable) throw new Error(`Telemetry export is disabled by policy: ${policy.id}`)
  const events = await listTelemetryEvents({
    policyId: policy.id,
    status: args.status,
    eventType: args.eventType,
    limit: args.limit ?? 200,
  })
  const now = Date.now()
  const manifest: JsonObject = {
    type: 'telemetry_export_manifest',
    generatedAt: now,
    policyId: policy.id,
    eventCount: events.length,
    includesRawSensitivePayload: false,
    neverCollect: policy.policy.neverCollect,
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      requestedLevel: event.requestedLevel,
      status: event.status,
      reason: event.reason,
      blockedFields: event.blockedFields,
      redactedFields: event.redactedFields,
      sanitizedPayload: event.sanitizedPayload,
      createdAt: event.createdAt,
    })),
    statusCounts: events.reduce<Record<string, number>>((acc, event) => {
      acc[event.status] = (acc[event.status] ?? 0) + 1
      return acc
    }, {}),
  }
  const row: TelemetryExportManifestRow = {
    id: newTelemetryExportManifestId(),
    policyId: policy.id,
    filters: {
      status: args.status ?? null,
      eventType: args.eventType ?? null,
      limit: args.limit ?? 200,
    },
    eventCount: events.length,
    manifest,
    createdAt: now,
  }
  await db.insert(schema.telemetryExportManifests).values(row)
  return row
}

export async function listTelemetryExportManifests(args: {
  policyId?: string
  limit?: number
} = {}): Promise<TelemetryExportManifestRow[]> {
  const filters: SQL[] = []
  if (args.policyId) filters.push(eq(schema.telemetryExportManifests.policyId, args.policyId))
  return db.query.telemetryExportManifests.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.telemetryExportManifests.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

function mergePolicy(args: CreateTelemetryPolicyArgs): TelemetryPolicy {
  const neverCollect = args.neverCollect?.length
    ? Array.from(new Set([...args.neverCollect, ...TELEMETRY_NEVER_COLLECT]))
    : TELEMETRY_NEVER_COLLECT
  return {
    ...defaultPolicy,
    level: args.level ?? defaultPolicy.level,
    consentGranted: args.consentGranted ?? defaultPolicy.consentGranted,
    minimal: { ...defaultPolicy.minimal, ...args.minimal },
    usage: { ...defaultPolicy.usage, ...args.usage },
    performance: { ...defaultPolicy.performance, ...args.performance },
    full: { ...defaultPolicy.full, ...args.full },
    neverCollect,
    exportable: args.exportable ?? defaultPolicy.exportable,
  }
}

function normalizeInput(args: EvaluateTelemetryEventArgs): TelemetryEventInput {
  return {
    level: args.level,
    eventType: args.eventType,
    payload: args.payload,
    contains: args.contains?.length ? Array.from(new Set(args.contains)) : [],
  }
}

function decideTelemetry(policy: TelemetryPolicy, input: TelemetryEventInput): TelemetryDecision {
  const disabledReason = disabledReasonFor(policy, input.level)
  if (disabledReason) {
    return {
      status: 'disabled',
      reason: disabledReason,
      allowedPayload: {},
      blockedFields: [],
      redactedFields: Object.keys(input.payload),
      collectedLevel: 'off',
    }
  }

  const scoped = scopePayloadToLevel(input.level, input.payload)
  const redactedFields = [...scoped.redactedFields]
  const sensitive = redactSensitive(scoped.payload, policy.neverCollect)
  redactedFields.push(...sensitive.redactedFields)
  const explicitBlocked = (input.contains ?? [])
    .filter((category) => policy.neverCollect.includes(category))
    .map((category) => `contains:${category}`)
  const blockedFields = [...sensitive.blockedFields, ...explicitBlocked]
  const allowedPayload = sensitive.payload

  if (!Object.keys(allowedPayload).length && (blockedFields.length || redactedFields.length)) {
    return {
      status: 'blocked',
      reason: 'Telemetry payload only contained data outside the enabled level or never-collect categories.',
      allowedPayload: {},
      blockedFields,
      redactedFields,
      collectedLevel: input.level,
    }
  }

  const status: TelemetryDecisionStatus =
    blockedFields.length || redactedFields.length ? 'redacted' : 'allowed'
  return {
    status,
    reason: status === 'allowed'
      ? 'Telemetry event is allowed under the explicit-consent policy.'
      : 'Telemetry event was reduced to allowed aggregate/safe fields; never-collect categories were removed.',
    allowedPayload,
    blockedFields,
    redactedFields,
    collectedLevel: input.level,
  }
}

function disabledReasonFor(policy: TelemetryPolicy, requestedLevel: TelemetryLevel): string {
  if (requestedLevel === 'off') return 'Telemetry event requested off level.'
  if (policy.level === 'off') return 'Telemetry is disabled until the user explicitly opts in.'
  if (policy.requiresExplicitConsent && !policy.consentGranted) {
    return 'Telemetry requires explicit first-start consent and consent has not been granted.'
  }
  if (levelRank[requestedLevel] > levelRank[policy.level]) {
    return `Requested telemetry level ${requestedLevel} is above configured level ${policy.level}.`
  }
  return ''
}

function scopePayloadToLevel(
  level: TelemetryLevel,
  payload: JsonObject,
): { payload: JsonObject; redactedFields: string[] } {
  if (level === 'full') return { payload: cloneObject(payload), redactedFields: [] }
  if (level === 'off') return { payload: {}, redactedFields: Object.keys(payload) }
  const allow = new Set(scopedKeys[level])
  const scoped: JsonObject = {}
  const redactedFields: string[] = []
  for (const [key, value] of Object.entries(payload)) {
    if (allow.has(key)) scoped[key] = value
    else redactedFields.push(key)
  }
  return { payload: scoped, redactedFields }
}

function redactSensitive(
  payload: JsonObject,
  neverCollect: TelemetryNeverCollectCategory[],
): { payload: JsonObject; redactedFields: string[]; blockedFields: string[] } {
  const redactedFields: string[] = []
  const blockedFields: string[] = []
  const redacted = redactValue(payload, '', new Set(neverCollect), redactedFields, blockedFields)
  return {
    payload: isJsonObject(redacted) ? redacted : {},
    redactedFields,
    blockedFields,
  }
}

function redactValue(
  value: unknown,
  path: string,
  neverCollect: Set<TelemetryNeverCollectCategory>,
  redactedFields: string[],
  blockedFields: string[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, `${path}[${index}]`, neverCollect, redactedFields, blockedFields))
  }
  if (!isJsonObject(value)) return value

  const next: JsonObject = {}
  for (const [key, item] of Object.entries(value)) {
    const itemPath = path ? `${path}.${key}` : key
    const category = categoryForKey(key)
    if (category && neverCollect.has(category)) {
      redactedFields.push(itemPath)
      blockedFields.push(`${itemPath}:${category}`)
      continue
    }
    next[key] = redactValue(item, itemPath, neverCollect, redactedFields, blockedFields)
  }
  return next
}

function categoryForKey(key: string): TelemetryNeverCollectCategory | null {
  return sensitiveKeyPatterns.find((entry) => entry.pattern.test(key))?.category ?? null
}

function cloneObject(payload: JsonObject): JsonObject {
  return { ...payload }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function getRequiredPolicy(id: string): Promise<TelemetryPolicyRow> {
  const row = await db.query.telemetryPolicies.findFirst({
    where: eq(schema.telemetryPolicies.id, id),
  })
  if (!row) throw new Error(`Telemetry policy not found: ${id}`)
  return row
}
