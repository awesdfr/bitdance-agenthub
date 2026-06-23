import { createHash, createHmac, randomBytes } from 'node:crypto'

import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  EmployeeRunRow,
  JsonObject,
  MemoryItemRow,
  MemoryScope,
  MemoryType,
  ProgrammaticApiKeyRow,
  SdkTaskRow,
  WebhookDeliveryMode,
  WebhookDeliveryRow,
  WebhookEventType,
  WebhookSubscriptionRow,
  WebhookSubscriptionStatus,
} from '@/db/schema'
import {
  newProgrammaticApiKeyId,
  newSdkTaskId,
  newWebhookDeliveryId,
  newWebhookSubscriptionId,
} from '@/server/ids'
import { createMemoryItem } from '@/server/control-plane-service'
import {
  startEmployeeRun,
} from '@/server/employee-runtime-service'
import { recordAuditLog } from '@/server/security-service'

export interface CreateProgrammaticApiKeyArgs {
  name: string
  scopes?: string[]
}

export interface ProgrammaticApiKeyCreated {
  apiKey: ProgrammaticApiKeyPublic
  rawKey: string
}

export type ProgrammaticApiKeyPublic = Omit<ProgrammaticApiKeyRow, 'keyHash'>

export interface CreateSdkTaskArgs {
  agentProfileId?: string | null
  agentName?: string | null
  description: string
  input?: JsonObject
  priority?: number
  maxBudget?: number | null
  maxBudgetCents?: number | null
  webhookUrl?: string | null
  apiKeyId?: string | null
}

export interface SdkTaskResult {
  sdkTask: SdkTaskRow
  employeeRun: EmployeeRunRow
  webhookDeliveries: WebhookDeliveryRow[]
}

export interface CreateSdkMemoryArgs {
  agentName?: string | null
  agentProfileId?: string | null
  type: MemoryType
  title: string
  content: string
  scope?: MemoryScope
  confidence?: number
  importance?: number
}

export interface CreateWebhookSubscriptionArgs {
  name: string
  url: string
  events?: WebhookEventType[]
  secret: string
  filter?: JsonObject
  retry?: {
    maxRetries?: number
    backoffMs?: number
  }
  deliveryMode?: WebhookDeliveryMode
  status?: WebhookSubscriptionStatus
}

export interface DispatchWebhookEventArgs {
  eventType: WebhookEventType
  agentProfileId?: string | null
  sdkTaskId?: string | null
  employeeRunId?: string | null
  priority?: number
  oneOffWebhookUrl?: string | null
  payload?: JsonObject
}

export async function createProgrammaticApiKey(
  args: CreateProgrammaticApiKeyArgs,
): Promise<ProgrammaticApiKeyCreated> {
  const rawKey = `rxk_${randomBytes(24).toString('base64url')}`
  const now = Date.now()
  const apiKey: ProgrammaticApiKeyRow = {
    id: newProgrammaticApiKeyId(),
    name: normalizeRequired(args.name, 'name'),
    keyPrefix: rawKey.slice(0, 12),
    keyHash: hashSecret(rawKey),
    scopes: normalizeStringArray(args.scopes).length ? normalizeStringArray(args.scopes) : ['tasks:write', 'tasks:read'],
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    revokedAt: null,
  }
  await db.insert(schema.programmaticApiKeys).values(apiKey)
  await recordAuditLog({
    actorType: 'system',
    action: 'programmatic_api_key.create',
    resourceType: 'programmatic_api_key',
    resourceId: apiKey.id,
    riskLevel: 'medium',
    message: `Programmatic API key ${apiKey.name} created.`,
    metadata: { scopes: apiKey.scopes, keyPrefix: apiKey.keyPrefix },
  })
  return { apiKey: redactProgrammaticApiKey(apiKey), rawKey }
}

export async function listProgrammaticApiKeys(): Promise<ProgrammaticApiKeyPublic[]> {
  const rows = await db.query.programmaticApiKeys.findMany({
    orderBy: [desc(schema.programmaticApiKeys.createdAt)],
    limit: 100,
  })
  return rows.map(redactProgrammaticApiKey)
}

export async function revokeProgrammaticApiKey(id: string): Promise<ProgrammaticApiKeyPublic> {
  const existing = await getRequiredProgrammaticApiKey(id)
  const now = Date.now()
  await db
    .update(schema.programmaticApiKeys)
    .set({ status: 'revoked', revokedAt: now, updatedAt: now })
    .where(eq(schema.programmaticApiKeys.id, id))
  await recordAuditLog({
    actorType: 'system',
    action: 'programmatic_api_key.revoke',
    resourceType: 'programmatic_api_key',
    resourceId: id,
    riskLevel: 'medium',
    message: `Programmatic API key ${existing.name} revoked.`,
  })
  return redactProgrammaticApiKey(await getRequiredProgrammaticApiKey(id))
}

export async function authenticateProgrammaticApiKey(
  rawKey: string | null | undefined,
): Promise<ProgrammaticApiKeyRow | null> {
  const keys = await db.query.programmaticApiKeys.findMany({
    where: eq(schema.programmaticApiKeys.status, 'active'),
  })
  if (keys.length === 0) return null
  const hash = hashSecret(rawKey ?? '')
  const match = keys.find((key) => key.keyHash === hash)
  if (!match) throw new Error('Invalid programmatic API key.')
  await db
    .update(schema.programmaticApiKeys)
    .set({ lastUsedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(schema.programmaticApiKeys.id, match.id))
  return { ...match, lastUsedAt: Date.now(), updatedAt: Date.now() }
}

export async function createSdkTask(args: CreateSdkTaskArgs): Promise<SdkTaskResult> {
  const agent = await resolveAgent(args.agentProfileId, args.agentName)
  const description = normalizeRequired(args.description, 'description')
  const maxBudgetCents =
    args.maxBudgetCents ?? (args.maxBudget === null || args.maxBudget === undefined
      ? null
      : Math.max(0, Math.round(args.maxBudget * 100)))
  const employeeRun = await startEmployeeRun({
    agentProfileId: agent.id,
    goal: description,
    input: args.input ?? {},
    budgetLimitCents: maxBudgetCents,
  })
  const now = Date.now()
  const sdkTask: SdkTaskRow = {
    id: newSdkTaskId(),
    apiKeyId: normalizeNullable(args.apiKeyId),
    employeeRunId: employeeRun.id,
    agentProfileId: agent.id,
    agentName: agent.name,
    description,
    input: args.input ?? {},
    priority: args.priority ?? 0,
    maxBudgetCents,
    webhookUrl: normalizeNullable(args.webhookUrl),
    status: mapRunStatusToTaskStatus(employeeRun.status),
    createdAt: now,
    updatedAt: now,
    completedAt: employeeRun.finishedAt,
  }
  await db.insert(schema.sdkTasks).values(sdkTask)
  await recordAuditLog({
    actorType: 'system',
    actorId: args.apiKeyId ?? null,
    action: 'sdk_task.create',
    resourceType: 'sdk_task',
    resourceId: sdkTask.id,
    message: `SDK task created for ${agent.name}.`,
    metadata: {
      employeeRunId: employeeRun.id,
      agentProfileId: agent.id,
      priority: sdkTask.priority,
      maxBudgetCents,
    },
  })
  const eventType = employeeRun.status === 'complete' ? 'run.completed' : employeeRun.status === 'failed' ? 'run.failed' : 'run.queued'
  const webhookDeliveries = await dispatchWebhookEvent({
    eventType,
    agentProfileId: agent.id,
    sdkTaskId: sdkTask.id,
    employeeRunId: employeeRun.id,
    priority: sdkTask.priority,
    oneOffWebhookUrl: sdkTask.webhookUrl,
  })
  return { sdkTask, employeeRun, webhookDeliveries }
}

export async function listSdkTasks(): Promise<SdkTaskRow[]> {
  const tasks = await db.query.sdkTasks.findMany({
    orderBy: [desc(schema.sdkTasks.createdAt)],
    limit: 100,
  })
  return Promise.all(tasks.map(syncSdkTaskStatus))
}

export async function getSdkTask(id: string): Promise<{ sdkTask: SdkTaskRow; employeeRun: EmployeeRunRow | null }> {
  const sdkTask = await syncSdkTaskStatus(await getRequiredSdkTask(id))
  const employeeRun = sdkTask.employeeRunId
    ? await db.query.employeeRuns.findFirst({ where: eq(schema.employeeRuns.id, sdkTask.employeeRunId) })
    : null
  return { sdkTask, employeeRun: employeeRun ?? null }
}

export async function listSdkAgents(): Promise<AgentProfileRow[]> {
  return db.query.agentProfiles.findMany({
    orderBy: [desc(schema.agentProfiles.updatedAt)],
    limit: 100,
  })
}

export async function getSdkAgent(identifier: string): Promise<AgentProfileRow> {
  return resolveAgent(identifier, identifier)
}

export async function createSdkMemory(args: CreateSdkMemoryArgs): Promise<MemoryItemRow> {
  const agent = await resolveAgent(args.agentProfileId, args.agentName)
  return createMemoryItem({
    agentProfileId: agent.id,
    scope: args.scope ?? 'agent',
    type: args.type,
    title: args.title,
    content: args.content,
    confidence: args.confidence,
    importance: args.importance,
  })
}

export async function createWebhookSubscription(
  args: CreateWebhookSubscriptionArgs,
): Promise<WebhookSubscriptionRow> {
  const now = Date.now()
  const row: WebhookSubscriptionRow = {
    id: newWebhookSubscriptionId(),
    name: normalizeRequired(args.name, 'name'),
    url: normalizeRequired(args.url, 'url'),
    events: normalizeWebhookEvents(args.events),
    secret: normalizeRequired(args.secret, 'secret'),
    filter: args.filter ?? {},
    maxRetries: Math.max(0, args.retry?.maxRetries ?? 3),
    backoffMs: Math.max(0, args.retry?.backoffMs ?? 30000),
    deliveryMode: args.deliveryMode ?? 'record_only',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.webhookSubscriptions).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'webhook_subscription.create',
    resourceType: 'webhook_subscription',
    resourceId: row.id,
    riskLevel: 'medium',
    message: `Webhook subscription ${row.name} created.`,
    metadata: {
      url: row.url,
      events: row.events,
      filter: row.filter,
      deliveryMode: row.deliveryMode,
    },
  })
  return row
}

export async function listWebhookSubscriptions(): Promise<WebhookSubscriptionRow[]> {
  return db.query.webhookSubscriptions.findMany({
    orderBy: [desc(schema.webhookSubscriptions.createdAt)],
    limit: 100,
  })
}

export async function dispatchWebhookTest(subscriptionId: string): Promise<WebhookDeliveryRow> {
  const subscription = await getRequiredWebhookSubscription(subscriptionId)
  const [delivery] = await createWebhookDeliveriesForSubscriptions({
    subscriptions: [subscription],
    eventType: 'webhook.test',
    priority: 0,
    payload: {
      event: 'webhook.test',
      message: 'This is a local record-only webhook test event.',
    },
  })
  return delivery
}

export async function dispatchWebhookEvent(
  args: DispatchWebhookEventArgs,
): Promise<WebhookDeliveryRow[]> {
  const subscriptions = (await db.query.webhookSubscriptions.findMany({
    where: eq(schema.webhookSubscriptions.status, 'active'),
    orderBy: [desc(schema.webhookSubscriptions.createdAt)],
  })).filter((subscription) => subscriptionMatches(subscription, args))
  const deliveries = await createWebhookDeliveriesForSubscriptions({
    subscriptions,
    eventType: args.eventType,
    sdkTaskId: args.sdkTaskId ?? null,
    employeeRunId: args.employeeRunId ?? null,
    priority: args.priority ?? 0,
    payload: await buildWebhookPayload(args),
  })
  if (args.oneOffWebhookUrl) {
    deliveries.push(
      await createWebhookDelivery({
        subscription: null,
        url: args.oneOffWebhookUrl,
        secret: `sdk-task:${args.sdkTaskId ?? 'one-off'}`,
        eventType: args.eventType,
        sdkTaskId: args.sdkTaskId ?? null,
        employeeRunId: args.employeeRunId ?? null,
        payload: await buildWebhookPayload(args),
        status: 'recorded',
      }),
    )
  }
  return deliveries
}

export async function listWebhookDeliveries(args: {
  subscriptionId?: string
  sdkTaskId?: string
} = {}): Promise<WebhookDeliveryRow[]> {
  const rows = await db.query.webhookDeliveries.findMany({
    where: args.subscriptionId
      ? eq(schema.webhookDeliveries.webhookSubscriptionId, args.subscriptionId)
      : args.sdkTaskId
        ? eq(schema.webhookDeliveries.sdkTaskId, args.sdkTaskId)
        : undefined,
    orderBy: [desc(schema.webhookDeliveries.createdAt)],
    limit: 100,
  })
  return rows
}

async function createWebhookDeliveriesForSubscriptions(args: {
  subscriptions: WebhookSubscriptionRow[]
  eventType: WebhookEventType
  sdkTaskId?: string | null
  employeeRunId?: string | null
  priority: number
  payload: JsonObject
}): Promise<WebhookDeliveryRow[]> {
  const deliveries: WebhookDeliveryRow[] = []
  for (const subscription of args.subscriptions) {
    deliveries.push(
      await createWebhookDelivery({
        subscription,
        url: subscription.url,
        secret: subscription.secret,
        eventType: args.eventType,
        sdkTaskId: args.sdkTaskId ?? null,
        employeeRunId: args.employeeRunId ?? null,
        payload: args.payload,
        status: subscription.deliveryMode === 'record_only' ? 'recorded' : 'queued',
      }),
    )
  }
  return deliveries
}

async function createWebhookDelivery(args: {
  subscription: WebhookSubscriptionRow | null
  url: string
  secret: string
  eventType: WebhookEventType
  sdkTaskId: string | null
  employeeRunId: string | null
  payload: JsonObject
  status: WebhookDeliveryRow['status']
}): Promise<WebhookDeliveryRow> {
  const now = Date.now()
  const signature = signWebhookPayload(args.secret, args.payload, now)
  const delivery: WebhookDeliveryRow = {
    id: newWebhookDeliveryId(),
    webhookSubscriptionId: args.subscription?.id ?? null,
    sdkTaskId: args.sdkTaskId,
    employeeRunId: args.employeeRunId,
    url: args.url,
    eventType: args.eventType,
    payload: args.payload,
    signature,
    status: args.status,
    attempt: 0,
    nextRetryAt: args.status === 'queued' ? now + (args.subscription?.backoffMs ?? 30000) : null,
    error: args.status === 'queued' ? 'HTTP delivery is queued; live posting requires an explicit worker.' : null,
    createdAt: now,
    deliveredAt: args.status === 'recorded' ? now : null,
  }
  await db.insert(schema.webhookDeliveries).values(delivery)
  await recordAuditLog({
    actorType: 'system',
    action: 'webhook_delivery.record',
    resourceType: 'webhook_delivery',
    resourceId: delivery.id,
    message: `Webhook event ${delivery.eventType} recorded for ${delivery.url}.`,
    metadata: {
      webhookSubscriptionId: delivery.webhookSubscriptionId,
      sdkTaskId: delivery.sdkTaskId,
      employeeRunId: delivery.employeeRunId,
      status: delivery.status,
    },
  })
  return delivery
}

async function buildWebhookPayload(args: DispatchWebhookEventArgs): Promise<JsonObject> {
  const [agent, task, run] = await Promise.all([
    args.agentProfileId
      ? db.query.agentProfiles.findFirst({ where: eq(schema.agentProfiles.id, args.agentProfileId) })
      : Promise.resolve(null),
    args.sdkTaskId
      ? db.query.sdkTasks.findFirst({ where: eq(schema.sdkTasks.id, args.sdkTaskId) })
      : Promise.resolve(null),
    args.employeeRunId
      ? db.query.employeeRuns.findFirst({ where: eq(schema.employeeRuns.id, args.employeeRunId) })
      : Promise.resolve(null),
  ])
  const durationMs = run?.finishedAt && run.startedAt ? run.finishedAt - run.startedAt : null
  return {
    event: args.eventType,
    timestamp: new Date().toISOString(),
    agent: agent ? { id: agent.id, name: agent.name, role: agent.role } : null,
    task: task ? { id: task.id, description: task.description, priority: task.priority } : null,
    run: run ? { id: run.id, status: run.status, phase: run.currentPhase } : null,
    result: run
      ? {
          status: run.status,
          artifact: getArtifactSummary(run.output),
          cost: { total: run.actualCostCents / 100, currency: 'USD' },
          durationMs,
        }
      : null,
    ...(args.payload ?? {}),
  }
}

async function syncSdkTaskStatus(task: SdkTaskRow): Promise<SdkTaskRow> {
  if (!task.employeeRunId) return task
  const run = await db.query.employeeRuns.findFirst({
    where: eq(schema.employeeRuns.id, task.employeeRunId),
  })
  if (!run) return task
  const status = mapRunStatusToTaskStatus(run.status)
  if (status === task.status && task.completedAt === run.finishedAt) return task
  await db
    .update(schema.sdkTasks)
    .set({ status, updatedAt: Date.now(), completedAt: run.finishedAt })
    .where(eq(schema.sdkTasks.id, task.id))
  return { ...task, status, updatedAt: Date.now(), completedAt: run.finishedAt }
}

async function resolveAgent(agentProfileId?: string | null, agentName?: string | null): Promise<AgentProfileRow> {
  const id = normalizeNullable(agentProfileId)
  if (id) {
    const agent = await db.query.agentProfiles.findFirst({
      where: eq(schema.agentProfiles.id, id),
    })
    if (agent) return agent
  }
  const name = normalizeNullable(agentName)
  if (name) {
    const agents = await db.query.agentProfiles.findMany()
    const agent = agents.find((row) => row.name === name || row.id === name)
    if (agent) return agent
  }
  throw new Error(`Agent not found: ${agentProfileId ?? agentName ?? 'missing identifier'}`)
}

async function getRequiredProgrammaticApiKey(id: string): Promise<ProgrammaticApiKeyRow> {
  const row = await db.query.programmaticApiKeys.findFirst({
    where: eq(schema.programmaticApiKeys.id, id),
  })
  if (!row) throw new Error(`Programmatic API key not found: ${id}`)
  return row
}

async function getRequiredSdkTask(id: string): Promise<SdkTaskRow> {
  const row = await db.query.sdkTasks.findFirst({
    where: eq(schema.sdkTasks.id, id),
  })
  if (!row) throw new Error(`SDK task not found: ${id}`)
  return row
}

async function getRequiredWebhookSubscription(id: string): Promise<WebhookSubscriptionRow> {
  const row = await db.query.webhookSubscriptions.findFirst({
    where: eq(schema.webhookSubscriptions.id, id),
  })
  if (!row) throw new Error(`Webhook subscription not found: ${id}`)
  return row
}

function subscriptionMatches(subscription: WebhookSubscriptionRow, args: DispatchWebhookEventArgs): boolean {
  if (!subscription.events.includes(args.eventType)) return false
  const agentIds = getStringArray(subscription.filter, 'agentIds')
  if (agentIds.length && (!args.agentProfileId || !agentIds.includes(args.agentProfileId))) return false
  const minPriority = getNumber(subscription.filter, 'minPriority')
  if (minPriority !== null && (args.priority ?? 0) < minPriority) return false
  return true
}

function mapRunStatusToTaskStatus(status: EmployeeRunRow['status']): SdkTaskRow['status'] {
  if (status === 'complete') return 'completed'
  if (status === 'failed' || status === 'aborted') return 'failed'
  if (status === 'paused') return 'canceled'
  if (status === 'running') return 'running'
  return 'queued'
}

function signWebhookPayload(secret: string, payload: JsonObject, timestamp: number): string {
  const body = JSON.stringify(payload)
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${digest}`
}

function getArtifactSummary(output: JsonObject | null): JsonObject | null {
  if (!output) return null
  const artifact = output.artifact
  return artifact && typeof artifact === 'object' && !Array.isArray(artifact)
    ? (artifact as JsonObject)
    : output
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function redactProgrammaticApiKey(row: ProgrammaticApiKeyRow): ProgrammaticApiKeyPublic {
  const { keyHash, ...rest } = row
  void keyHash
  return rest
}

function normalizeWebhookEvents(events?: WebhookEventType[]): WebhookEventType[] {
  const normalized = events?.filter(Boolean) ?? []
  return normalized.length ? [...new Set(normalized)] : ['run.completed', 'run.failed']
}

function normalizeRequired(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function normalizeStringArray(values?: string[] | null): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

function getStringArray(obj: JsonObject, key: string): string[] {
  const value = obj[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function getNumber(obj: JsonObject, key: string): number | null {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
