import { and, desc, eq, inArray, lte } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  TaskBatchBenefits,
  TaskBatchExclusionReason,
  TaskBatchRow,
  TaskBatchStatus,
  TaskBatchStrategy,
  TaskQueueItemRow,
} from '@/db/schema'
import { newTaskBatchId, newTaskQueueItemId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface PlanTaskBatchArgs {
  queueId: string
  now?: number
  strategy?: Partial<TaskBatchStrategy>
}

export interface ListTaskBatchesArgs {
  queueId?: string
  status?: TaskBatchStatus
  limit?: number
}

const DEFAULT_STRATEGY: TaskBatchStrategy = {
  windowMs: 60_000,
  maxBatchSize: 5,
  mergeable: {
    sameAgent: true,
    sameType: true,
    sameProject: true,
    crossAgent: false,
  },
  exclusionRules: ['priority == 1', 'estimated_duration > 10m', 'requires_approval'],
}

export async function planTaskBatch(args: PlanTaskBatchArgs): Promise<TaskBatchRow> {
  const queue = await db.query.taskQueues.findFirst({ where: eq(schema.taskQueues.id, args.queueId) })
  if (!queue) throw new Error(`Task queue not found: ${args.queueId}`)

  const strategy = normalizeStrategy(args.strategy)
  const now = args.now ?? Date.now()
  const windowStart = now - strategy.windowMs
  const queuedItems = await db.query.taskQueueItems.findMany({
    where: and(
      eq(schema.taskQueueItems.queueId, queue.id),
      eq(schema.taskQueueItems.status, 'queued'),
      lte(schema.taskQueueItems.scheduledAt, now),
    ),
    orderBy: [desc(schema.taskQueueItems.priority), desc(schema.taskQueueItems.createdAt)],
    limit: 500,
  })

  const candidates = queuedItems.filter(
    (item) => item.createdAt >= windowStart || item.scheduledAt >= windowStart,
  )
  const { eligible, exclusionReasons } = partitionEligible(candidates, strategy)
  const { selected, mergeKey } = selectBestGroup(eligible, strategy)
  const sourceItems = selected.slice(0, strategy.maxBatchSize)
  const benefits = calculateBenefits(sourceItems)
  const mergedPayload = buildMergedPayload(queue.id, sourceItems, mergeKey, strategy, benefits)
  const nowStored = Date.now()
  const row: TaskBatchRow = {
    id: newTaskBatchId(),
    queueId: queue.id,
    sourceItemIds: sourceItems.map((item) => item.id),
    batchItemId: null,
    strategy,
    benefits,
    mergedPayload,
    exclusionReasons,
    status: sourceItems.length >= 2 ? 'planned' : 'skipped',
    createdAt: nowStored,
    appliedAt: null,
  }

  await db.insert(schema.taskBatches).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'task_batch.plan',
    resourceType: 'task_batch',
    resourceId: row.id,
    status: row.status === 'planned' ? 'allowed' : 'blocked',
    riskLevel: 'low',
    message:
      row.status === 'planned'
        ? `Task batch ${row.id} planned with ${row.sourceItemIds.length} source task(s).`
        : 'No mergeable task batch was found in the selected queue window.',
    metadata: taskBatchSnapshot(row),
  })
  return row
}

export async function applyTaskBatch(batchId: string): Promise<TaskBatchRow> {
  const batch = await getRequiredTaskBatch(batchId)
  if (batch.status === 'batched') return batch
  if (batch.status === 'skipped' || batch.sourceItemIds.length < 2) {
    throw new Error(`Task batch ${batch.id} has fewer than two mergeable source tasks.`)
  }

  const sourceItems = await db.query.taskQueueItems.findMany({
    where: inArray(schema.taskQueueItems.id, batch.sourceItemIds),
  })
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]))
  const missing = batch.sourceItemIds.filter((id) => !sourceById.has(id))
  if (missing.length > 0) {
    throw new Error(`Task batch ${batch.id} references missing source task(s): ${missing.join(', ')}`)
  }
  const notQueued = sourceItems.filter((item) => item.status !== 'queued')
  if (notQueued.length > 0) {
    throw new Error(
      `Task batch ${batch.id} can only apply queued source tasks; blocked by ${notQueued
        .map((item) => `${item.id}:${item.status}`)
        .join(', ')}`,
    )
  }

  const now = Date.now()
  const batchItemId = newTaskQueueItemId()
  const batchItem: TaskQueueItemRow = {
    id: batchItemId,
    queueId: batch.queueId,
    kind: 'task_batch',
    status: 'queued',
    priority: Math.max(...sourceItems.map((item) => item.priority)),
    payload: {
      ...batch.mergedPayload,
      taskBatchId: batch.id,
      sourceItemIds: batch.sourceItemIds,
    },
    result: null,
    error: null,
    scheduledAt: now,
    lockedAt: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(schema.taskQueueItems).values(batchItem)
  await db
    .update(schema.taskQueueItems)
    .set({
      status: 'canceled',
      result: {
        batchedInto: batchItemId,
        taskBatchId: batch.id,
      },
      finishedAt: now,
      updatedAt: now,
    })
    .where(inArray(schema.taskQueueItems.id, batch.sourceItemIds))
  await db
    .update(schema.taskBatches)
    .set({
      status: 'batched',
      batchItemId,
      appliedAt: now,
    })
    .where(eq(schema.taskBatches.id, batch.id))

  const updated = await getRequiredTaskBatch(batch.id)
  await recordAuditLog({
    actorType: 'system',
    action: 'task_batch.apply',
    resourceType: 'task_batch',
    resourceId: updated.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Task batch ${updated.id} created queued task ${batchItemId}.`,
    metadata: taskBatchSnapshot(updated),
  })
  return updated
}

export async function listTaskBatches(args: ListTaskBatchesArgs = {}): Promise<TaskBatchRow[]> {
  const filters = [
    args.queueId ? eq(schema.taskBatches.queueId, args.queueId) : undefined,
    args.status ? eq(schema.taskBatches.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.taskBatches.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.taskBatches.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

async function getRequiredTaskBatch(id: string): Promise<TaskBatchRow> {
  const row = await db.query.taskBatches.findFirst({ where: eq(schema.taskBatches.id, id) })
  if (!row) throw new Error(`Task batch not found: ${id}`)
  return row
}

function normalizeStrategy(strategy: Partial<TaskBatchStrategy> | undefined): TaskBatchStrategy {
  return {
    ...DEFAULT_STRATEGY,
    ...(strategy ?? {}),
    mergeable: {
      ...DEFAULT_STRATEGY.mergeable,
      ...(strategy?.mergeable ?? {}),
    },
    exclusionRules: strategy?.exclusionRules ?? DEFAULT_STRATEGY.exclusionRules,
  }
}

function partitionEligible(
  items: TaskQueueItemRow[],
  strategy: TaskBatchStrategy,
): { eligible: TaskQueueItemRow[]; exclusionReasons: TaskBatchExclusionReason[] } {
  const exclusionReasons: TaskBatchExclusionReason[] = []
  const eligible: TaskQueueItemRow[] = []
  for (const item of items) {
    const exclusion = exclusionForItem(item, strategy)
    if (exclusion) {
      exclusionReasons.push(exclusion)
    } else {
      eligible.push(item)
    }
  }
  return { eligible, exclusionReasons }
}

function exclusionForItem(
  item: TaskQueueItemRow,
  strategy: TaskBatchStrategy,
): TaskBatchExclusionReason | null {
  if (strategy.exclusionRules.includes('priority == 1') && item.priority === 1) {
    return { taskQueueItemId: item.id, rule: 'priority == 1', reason: 'Highest-priority tasks stay single for fastest dispatch.' }
  }
  if (
    strategy.exclusionRules.includes('estimated_duration > 10m') &&
    estimatedDurationMs(item.payload) > 10 * 60 * 1000
  ) {
    return { taskQueueItemId: item.id, rule: 'estimated_duration > 10m', reason: 'Long tasks are excluded to avoid hiding progress and risk.' }
  }
  if (strategy.exclusionRules.includes('requires_approval') && readBoolean(item.payload, 'requiresApproval') === true) {
    return { taskQueueItemId: item.id, rule: 'requires_approval', reason: 'Approval-gated tasks remain individually visible.' }
  }
  return null
}

function selectBestGroup(
  items: TaskQueueItemRow[],
  strategy: TaskBatchStrategy,
): { selected: TaskQueueItemRow[]; mergeKey: string } {
  const groups = new Map<string, TaskQueueItemRow[]>()
  for (const item of items) {
    const key = mergeKeyForItem(item, strategy)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const [mergeKey, selected] =
    Array.from(groups.entries()).sort((left, right) => {
      if (right[1].length !== left[1].length) return right[1].length - left[1].length
      return Math.max(...right[1].map((item) => item.priority)) - Math.max(...left[1].map((item) => item.priority))
    })[0] ?? ['none', []]
  return {
    mergeKey,
    selected: selected
      .slice()
      .sort((left, right) => right.priority - left.priority || left.scheduledAt - right.scheduledAt),
  }
}

function mergeKeyForItem(item: TaskQueueItemRow, strategy: TaskBatchStrategy): string {
  const parts: string[] = []
  if (strategy.mergeable.sameAgent || !strategy.mergeable.crossAgent) {
    parts.push(`agent:${readString(item.payload, 'agentProfileId') ?? 'unassigned'}`)
  }
  if (strategy.mergeable.sameType) {
    parts.push(`type:${taskTypeForItem(item)}`)
  }
  if (strategy.mergeable.sameProject) {
    parts.push(`project:${readString(item.payload, 'projectId') ?? readString(item.payload, 'projectKey') ?? 'none'}`)
  }
  return parts.length > 0 ? parts.join('|') : 'all'
}

function taskTypeForItem(item: TaskQueueItemRow): string {
  return readString(item.payload, 'taskType') ?? readString(item.payload, 'type') ?? item.kind
}

function calculateBenefits(items: TaskQueueItemRow[]): TaskBatchBenefits {
  const costCents = items.map((item) => estimatedCostCents(item.payload))
  const durations = items.map((item) => estimatedDurationMs(item.payload))
  const savedCostCents = Math.max(0, sum(costCents) - max(costCents))
  const savedTimeMs = Math.max(0, sum(durations) - max(durations))
  return {
    savedModelCalls: Math.max(0, items.length - 1),
    savedCostCents,
    savedCost: Math.round((savedCostCents / 100) * 100) / 100,
    savedTimeMs,
    savedTime: formatDuration(savedTimeMs),
  }
}

function buildMergedPayload(
  queueId: string,
  items: TaskQueueItemRow[],
  mergeKey: string,
  strategy: TaskBatchStrategy,
  benefits: TaskBatchBenefits,
): JsonObject {
  return {
    source: 'task_batching',
    queueId,
    mergeKey,
    taskCount: items.length,
    sourceItemIds: items.map((item) => item.id),
    strategy,
    benefits,
    mergedTasks: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      priority: item.priority,
      agentProfileId: readString(item.payload, 'agentProfileId'),
      projectId: readString(item.payload, 'projectId') ?? readString(item.payload, 'projectKey'),
      taskType: taskTypeForItem(item),
      payload: item.payload,
    })),
  }
}

function estimatedCostCents(payload: JsonObject): number {
  const direct = readNumber(payload, 'estimatedCostCents') ?? readNumber(payload, 'costCents')
  if (direct !== null) return Math.max(0, Math.round(direct))
  const dollars = readNumber(payload, 'estimatedCost') ?? readNumber(payload, 'cost')
  return dollars !== null ? Math.max(0, Math.round(dollars * 100)) : 0
}

function estimatedDurationMs(payload: JsonObject): number {
  const direct = readNumber(payload, 'estimatedDurationMs') ?? readNumber(payload, 'durationMs')
  if (direct !== null) return Math.max(0, Math.round(direct))
  const minutes = readNumber(payload, 'estimatedDurationMinutes') ?? readNumber(payload, 'durationMinutes')
  if (minutes !== null) return Math.max(0, Math.round(minutes * 60 * 1000))
  const duration = readString(payload, 'estimatedDuration') ?? readString(payload, 'duration')
  if (!duration) return 0
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i.exec(duration.trim())
  if (!match) return 0
  const value = Number(match[1])
  const unit = match[2].toLowerCase()
  if (unit === 'ms') return Math.round(value)
  if (unit === 's') return Math.round(value * 1000)
  if (unit === 'm') return Math.round(value * 60 * 1000)
  return Math.round(value * 60 * 60 * 1000)
}

function readString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(obj: JsonObject, key: string): number | null {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(obj: JsonObject, key: string): boolean | null {
  const value = obj[key]
  return typeof value === 'boolean' ? value : null
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function max(values: number[]): number {
  return values.length > 0 ? Math.max(...values) : 0
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.round(ms / 60 / 60_000)}h`
}

function taskBatchSnapshot(row: TaskBatchRow): JsonObject {
  return {
    queueId: row.queueId,
    status: row.status,
    sourceItemIds: row.sourceItemIds,
    batchItemId: row.batchItemId,
    benefits: row.benefits,
    exclusionReasons: row.exclusionReasons,
  }
}
