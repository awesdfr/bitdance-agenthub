import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  ResourceLockRow,
  ResourceType,
  TaskScheduleKind,
  TaskScheduleRow,
  TaskScheduleStatus,
  TaskQueueItemKind,
  TaskQueueItemRow,
  TaskQueueRow,
  TaskQueueStatus,
} from '@/db/schema'
import {
  getRequiredContinuationPlan,
  listContinuationPlans,
  updateContinuationPlanStatus,
} from '@/server/agent-continuity-service'
import { startEmployeeRun } from '@/server/employee-runtime-service'
import { newTaskQueueId, newTaskQueueItemId, newTaskScheduleId } from '@/server/ids'
import {
  acquireResourceLock,
  releaseResourceLocks,
} from '@/server/resource-lock-service'
import { recordAuditLog } from '@/server/security-service'

export interface CreateTaskQueueArgs {
  name: string
  concurrencyLimit?: number
  status?: TaskQueueStatus
}

export async function createTaskQueue(args: CreateTaskQueueArgs): Promise<TaskQueueRow> {
  const now = Date.now()
  const row: TaskQueueRow = {
    id: newTaskQueueId(),
    name: normalizeRequired(args.name, 'name'),
    status: args.status ?? 'active',
    concurrencyLimit: normalizeConcurrency(args.concurrencyLimit),
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.taskQueues).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'task_queue.create',
    resourceType: 'task_queue',
    resourceId: row.id,
    message: `Task queue ${row.name} was created.`,
    metadata: { concurrencyLimit: row.concurrencyLimit, status: row.status },
  })
  return row
}

export async function listTaskQueues(): Promise<TaskQueueRow[]> {
  return db.query.taskQueues.findMany({ orderBy: [desc(schema.taskQueues.createdAt)] })
}

export interface EnqueueTaskArgs {
  queueId: string
  kind: TaskQueueItemKind
  payload: JsonObject
  priority?: number
  scheduledAt?: number
}

export async function enqueueTask(args: EnqueueTaskArgs): Promise<TaskQueueItemRow> {
  await getRequiredTaskQueue(args.queueId)
  const now = Date.now()
  const row: TaskQueueItemRow = {
    id: newTaskQueueItemId(),
    queueId: args.queueId,
    kind: args.kind,
    status: 'queued',
    priority: args.priority ?? 0,
    payload: args.payload,
    result: null,
    error: null,
    scheduledAt: args.scheduledAt ?? now,
    lockedAt: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.taskQueueItems).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'task_queue.enqueue',
    resourceType: 'task_queue_item',
    resourceId: row.id,
    message: `Task ${row.kind} was queued.`,
    metadata: {
      queueId: row.queueId,
      priority: row.priority,
      scheduledAt: row.scheduledAt,
    },
  })
  return row
}

export interface EnqueueDueContinuationPlansArgs {
  queueId: string
  now?: number
  limit?: number
  priority?: number
  budgetLimitCents?: number | null
}

export interface EnqueueDueContinuationPlansResult {
  queue: TaskQueueRow
  scanned: number
  due: number
  queued: number
  skipped: number
  items: TaskQueueItemRow[]
}

export async function enqueueDueContinuationPlans(
  args: EnqueueDueContinuationPlansArgs,
): Promise<EnqueueDueContinuationPlansResult> {
  const queue = await getRequiredTaskQueue(args.queueId)
  const now = args.now ?? Date.now()
  const plans = await listContinuationPlans({
    status: 'open',
    limit: normalizeScanLimit(args.limit),
  })
  const duePlans = plans.filter((plan) => plan.dueAt !== null && plan.dueAt <= now)
  const items: TaskQueueItemRow[] = []
  let skipped = 0

  for (const plan of duePlans) {
    if (!plan.agentProfileId) {
      skipped += 1
      continue
    }
    const alreadyQueued = await hasPendingContinuationPlanTask(queue.id, plan.id)
    if (alreadyQueued) {
      skipped += 1
      continue
    }
    const item = await enqueueTask({
      queueId: queue.id,
      kind: 'continuation_plan',
      priority: args.priority ?? 0,
      scheduledAt: now,
      payload: {
        continuationPlanId: plan.id,
        budgetLimitCents: args.budgetLimitCents ?? null,
        autoComplete: true,
        source: 'due_continuation_scan',
      },
    })
    items.push(item)
  }

  return {
    queue,
    scanned: plans.length,
    due: duePlans.length,
    queued: items.length,
    skipped,
    items,
  }
}

export async function listTaskQueueItems(queueId?: string): Promise<TaskQueueItemRow[]> {
  return db.query.taskQueueItems.findMany({
    where: queueId ? eq(schema.taskQueueItems.queueId, queueId) : undefined,
    orderBy: [
      desc(schema.taskQueueItems.priority),
      asc(schema.taskQueueItems.scheduledAt),
      desc(schema.taskQueueItems.createdAt),
    ],
    limit: 100,
  })
}

export interface CreateTaskScheduleArgs {
  queueId: string
  name: string
  kind?: TaskScheduleKind
  status?: TaskScheduleStatus
  intervalMs: number
  nextRunAt?: number
  payload?: JsonObject
}

export async function createTaskSchedule(
  args: CreateTaskScheduleArgs,
): Promise<TaskScheduleRow> {
  await getRequiredTaskQueue(args.queueId)
  const now = Date.now()
  const row: TaskScheduleRow = {
    id: newTaskScheduleId(),
    queueId: args.queueId,
    name: normalizeRequired(args.name, 'name'),
    kind: args.kind ?? 'task_queue_tick',
    status: args.status ?? 'active',
    intervalMs: normalizeIntervalMs(args.intervalMs),
    nextRunAt: args.nextRunAt ?? now,
    lastRunAt: null,
    payload: args.payload ?? {},
    lastResult: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.taskSchedules).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'task_schedule.create',
    resourceType: 'task_schedule',
    resourceId: row.id,
    message: `Task schedule ${row.name} was created.`,
    metadata: {
      queueId: row.queueId,
      kind: row.kind,
      intervalMs: row.intervalMs,
      nextRunAt: row.nextRunAt,
    },
  })
  return row
}

export async function listTaskSchedules(queueId?: string): Promise<TaskScheduleRow[]> {
  return db.query.taskSchedules.findMany({
    where: queueId ? eq(schema.taskSchedules.queueId, queueId) : undefined,
    orderBy: [asc(schema.taskSchedules.nextRunAt), desc(schema.taskSchedules.createdAt)],
    limit: 100,
  })
}

export interface RunDueTaskSchedulesArgs {
  now?: number
  limit?: number
}

export interface TaskScheduleExecutionResult {
  schedule: TaskScheduleRow
  result: JsonObject | null
  error: string | null
}

export interface RunDueTaskSchedulesResult {
  now: number
  scanned: number
  ran: number
  failed: number
  results: TaskScheduleExecutionResult[]
}

export async function runDueTaskSchedules(
  args: RunDueTaskSchedulesArgs = {},
): Promise<RunDueTaskSchedulesResult> {
  const now = args.now ?? Date.now()
  const schedules = await db.query.taskSchedules.findMany({
    where: and(
      eq(schema.taskSchedules.status, 'active'),
      lte(schema.taskSchedules.nextRunAt, now),
    ),
    orderBy: [asc(schema.taskSchedules.nextRunAt)],
    limit: normalizeScanLimit(args.limit),
  })

  const results: TaskScheduleExecutionResult[] = []
  let ran = 0
  let failed = 0
  for (const schedule of schedules) {
    try {
      const result = await executeTaskSchedule(schedule, now)
      const updated = await updateTaskScheduleAfterRun(schedule, now, result, null)
      results.push({ schedule: updated, result, error: null })
      ran += 1
    } catch (err) {
      const message = formatError(err)
      const updated = await updateTaskScheduleAfterRun(schedule, now, { error: message }, message)
      results.push({ schedule: updated, result: null, error: message })
      failed += 1
    }
  }

  return {
    now,
    scanned: schedules.length,
    ran,
    failed,
    results,
  }
}

export interface ProcessTaskQueueResult {
  queue: TaskQueueRow
  started: number
  completed: number
  failed: number
  skipped: number
  items: TaskQueueItemRow[]
}

export async function processTaskQueue(
  queueId: string,
  maxItems?: number,
): Promise<ProcessTaskQueueResult> {
  const queue = await getRequiredTaskQueue(queueId)
  if (queue.status !== 'active') {
    return { queue, started: 0, completed: 0, failed: 0, skipped: 0, items: [] }
  }

  const running = await db.query.taskQueueItems.findMany({
    where: and(eq(schema.taskQueueItems.queueId, queueId), eq(schema.taskQueueItems.status, 'running')),
  })
  const available = Math.max(0, queue.concurrencyLimit - running.length)
  const limit = Math.min(available, Math.max(1, maxItems ?? available))
  if (limit === 0) return { queue, started: 0, completed: 0, failed: 0, skipped: running.length, items: [] }

  const dueItems = await db.query.taskQueueItems.findMany({
    where: and(
      eq(schema.taskQueueItems.queueId, queueId),
      eq(schema.taskQueueItems.status, 'queued'),
      lte(schema.taskQueueItems.scheduledAt, Date.now()),
    ),
    orderBy: [desc(schema.taskQueueItems.priority), asc(schema.taskQueueItems.scheduledAt)],
    limit,
  })

  const processed: TaskQueueItemRow[] = []
  let completed = 0
  let failed = 0
  for (const item of dueItems) {
    const started = await markTaskQueueItemRunning(item)
    try {
      const result = await executeTaskQueueItemWithResourceLocks(started)
      const finished = await finishTaskQueueItem(started.id, 'complete', result, null)
      processed.push(finished)
      completed += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const finished = await finishTaskQueueItem(started.id, 'failed', null, message)
      processed.push(finished)
      failed += 1
    }
  }
  return { queue, started: dueItems.length, completed, failed, skipped: running.length, items: processed }
}

export interface RunTaskQueueTickArgs {
  maxItems?: number
  enqueueDueContinuationPlans?: boolean
  now?: number
  continuationScanLimit?: number
  continuationPriority?: number
  budgetLimitCents?: number | null
}

export interface RunTaskQueueTickResult {
  queue: TaskQueueRow
  dueContinuationPlans: EnqueueDueContinuationPlansResult | null
  processed: ProcessTaskQueueResult
}

export async function runTaskQueueTick(
  queueId: string,
  args: RunTaskQueueTickArgs = {},
): Promise<RunTaskQueueTickResult> {
  const dueContinuationPlans =
    args.enqueueDueContinuationPlans === false
      ? null
      : await enqueueDueContinuationPlans({
          queueId,
          now: args.now,
          limit: args.continuationScanLimit,
          priority: args.continuationPriority,
          budgetLimitCents: args.budgetLimitCents,
        })
  const processed = await processTaskQueue(queueId, args.maxItems)
  return {
    queue: processed.queue,
    dueContinuationPlans,
    processed,
  }
}

async function executeTaskSchedule(schedule: TaskScheduleRow, now: number): Promise<JsonObject> {
  if (schedule.kind === 'enqueue_due_continuations') {
    const result = await enqueueDueContinuationPlans({
      queueId: schedule.queueId,
      now: getNumber(schedule.payload, 'now') ?? now,
      limit: getNumber(schedule.payload, 'limit') ?? undefined,
      priority: getNumber(schedule.payload, 'priority') ?? undefined,
      budgetLimitCents: getNumber(schedule.payload, 'budgetLimitCents'),
    })
    return {
      scheduleKind: schedule.kind,
      queued: result.queued,
      skipped: result.skipped,
      due: result.due,
      itemIds: result.items.map((item) => item.id),
    }
  }

  const result = await runTaskQueueTick(schedule.queueId, {
    maxItems: getNumber(schedule.payload, 'maxItems') ?? undefined,
    enqueueDueContinuationPlans: getBoolean(schedule.payload, 'enqueueDueContinuationPlans') ?? true,
    now: getNumber(schedule.payload, 'now') ?? now,
    continuationScanLimit: getNumber(schedule.payload, 'continuationScanLimit') ?? undefined,
    continuationPriority: getNumber(schedule.payload, 'continuationPriority') ?? undefined,
    budgetLimitCents: getNumber(schedule.payload, 'budgetLimitCents'),
  })
  return {
    scheduleKind: schedule.kind,
    dueContinuationPlans: result.dueContinuationPlans
      ? {
          queued: result.dueContinuationPlans.queued,
          skipped: result.dueContinuationPlans.skipped,
          due: result.dueContinuationPlans.due,
          itemIds: result.dueContinuationPlans.items.map((item) => item.id),
        }
      : null,
    processed: {
      started: result.processed.started,
      completed: result.processed.completed,
      failed: result.processed.failed,
      skipped: result.processed.skipped,
      itemIds: result.processed.items.map((item) => item.id),
    },
  }
}

async function updateTaskScheduleAfterRun(
  schedule: TaskScheduleRow,
  now: number,
  result: JsonObject,
  error: string | null,
): Promise<TaskScheduleRow> {
  const nextRunAt = now + schedule.intervalMs
  await db
    .update(schema.taskSchedules)
    .set({
      lastRunAt: now,
      nextRunAt,
      lastResult: error ? { status: 'failed', error, ...result } : { status: 'complete', ...result },
      updatedAt: now,
    })
    .where(eq(schema.taskSchedules.id, schedule.id))
  await recordAuditLog({
    actorType: 'system',
    action: error ? 'task_schedule.fail' : 'task_schedule.run',
    resourceType: 'task_schedule',
    resourceId: schedule.id,
    status: error ? 'blocked' : 'allowed',
    riskLevel: error ? 'medium' : 'low',
    message: error ?? `Task schedule ${schedule.name} ran.`,
    metadata: {
      queueId: schedule.queueId,
      kind: schedule.kind,
      nextRunAt,
    },
  })
  const updated = await db.query.taskSchedules.findFirst({
    where: eq(schema.taskSchedules.id, schedule.id),
  })
  if (!updated) throw new Error(`Task schedule not found after run: ${schedule.id}`)
  return updated
}

export async function cancelTaskQueueItem(id: string): Promise<TaskQueueItemRow> {
  const item = await getRequiredTaskQueueItem(id)
  if (!['queued', 'running'].includes(item.status)) return item
  await db
    .update(schema.taskQueueItems)
    .set({
      status: 'canceled',
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(schema.taskQueueItems.id, id))
  await recordAuditLog({
    actorType: 'system',
    action: 'task_queue.cancel',
    resourceType: 'task_queue_item',
    resourceId: id,
    status: 'blocked',
    riskLevel: 'medium',
    message: 'Task queue item was canceled.',
  })
  return getRequiredTaskQueueItem(id)
}

async function markTaskQueueItemRunning(item: TaskQueueItemRow): Promise<TaskQueueItemRow> {
  const now = Date.now()
  await db
    .update(schema.taskQueueItems)
    .set({
      status: 'running',
      lockedAt: now,
      startedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.taskQueueItems.id, item.id))
  await recordAuditLog({
    actorType: 'system',
    action: 'task_queue.start',
    resourceType: 'task_queue_item',
    resourceId: item.id,
    message: `Task ${item.kind} started.`,
    metadata: { queueId: item.queueId },
  })
  return getRequiredTaskQueueItem(item.id)
}

async function executeTaskQueueItemWithResourceLocks(
  item: TaskQueueItemRow,
): Promise<JsonObject> {
  const requirements = getResourceRequirements(item.payload)
  if (requirements.length === 0) return executeTaskQueueItem(item)

  const locks = await acquireTaskQueueItemLocks(item, requirements)
  try {
    const result = await executeTaskQueueItem(item)
    const releasedLocks = await releaseResourceLocks(locks.map((lock) => lock.id))
    return {
      ...result,
      resourceLocks: releasedLocks.map(lockSummary),
    }
  } catch (err) {
    await releaseResourceLocks(locks.map((lock) => lock.id))
    throw err
  }
}

async function executeTaskQueueItem(item: TaskQueueItemRow): Promise<JsonObject> {
  if (item.kind === 'employee_run') {
    return executeEmployeeRunTask(item)
  }
  if (item.kind === 'continuation_plan') {
    return executeContinuationPlanTask(item)
  }
  if (item.kind === 'task_batch') {
    return executeTaskBatchTask(item)
  }
  throw new Error(`Task kind is reserved but not enabled in scheduler baseline: ${item.kind}`)
}

async function acquireTaskQueueItemLocks(
  item: TaskQueueItemRow,
  requirements: TaskResourceRequirement[],
): Promise<ResourceLockRow[]> {
  const acquired: ResourceLockRow[] = []
  try {
    for (const requirement of dedupeResourceRequirements(requirements)) {
      acquired.push(
        await acquireResourceLock({
          resourceType: requirement.resourceType,
          resourceId: requirement.resourceId,
          ownerRunId: item.id,
          ownerAgentId:
            requirement.ownerAgentId ?? getString(item.payload, 'agentProfileId') ?? 'scheduler',
          ttlMs: requirement.ttlMs,
        }),
      )
    }
    return acquired
  } catch (err) {
    await releaseResourceLocks(acquired.map((lock) => lock.id))
    throw new Error(`Failed to acquire task resource locks for ${item.id}: ${formatError(err)}`)
  }
}

async function executeEmployeeRunTask(item: TaskQueueItemRow): Promise<JsonObject> {
  const agentProfileId = getString(item.payload, 'agentProfileId')
  const goal = getString(item.payload, 'goal')
  if (!agentProfileId || !goal) {
    throw new Error('employee_run task payload requires agentProfileId and goal.')
  }
  const run = await startEmployeeRun({
    agentProfileId,
    goal,
    input: getJsonObject(item.payload, 'input') ?? { source: 'task_queue' },
    workflowRunId: getString(item.payload, 'workflowRunId'),
    budgetLimitCents: getNumber(item.payload, 'budgetLimitCents'),
    autoComplete: getBoolean(item.payload, 'autoComplete') ?? true,
  })
  return {
    employeeRunId: run.id,
    employeeRunStatus: run.status,
    agentProfileId,
  }
}

async function executeContinuationPlanTask(item: TaskQueueItemRow): Promise<JsonObject> {
  const continuationPlanId = getString(item.payload, 'continuationPlanId')
  if (!continuationPlanId) {
    throw new Error('continuation_plan task payload requires continuationPlanId.')
  }
  const plan = await getRequiredContinuationPlan(continuationPlanId)
  if (plan.status === 'completed' || plan.status === 'canceled') {
    throw new Error(`Continuation plan is not runnable from status ${plan.status}.`)
  }
  if (!plan.agentProfileId) {
    throw new Error('Continuation plan requires agentProfileId before it can be scheduled.')
  }

  await updateContinuationPlanStatus(plan.id, 'in_progress')
  try {
    const payloadInput = getJsonObject(item.payload, 'input') ?? {}
    const autoComplete = getBoolean(item.payload, 'autoComplete') ?? true
    const run = await startEmployeeRun({
      agentProfileId: plan.agentProfileId,
      goal: getString(item.payload, 'goal') ?? getString(plan.resumeInput, 'goal') ?? plan.title,
      input: {
        ...plan.resumeInput,
        ...payloadInput,
        source: 'continuation_plan',
        continuationPlanId: plan.id,
        sourceRunId: plan.sourceRunId,
      },
      workflowRunId: getString(item.payload, 'workflowRunId') ?? plan.workflowRunId,
      budgetLimitCents: getNumber(item.payload, 'budgetLimitCents'),
      autoComplete,
    })

    if (run.status !== 'complete' && autoComplete) {
      await updateContinuationPlanStatus(plan.id, 'open')
      throw new Error(`Continuation plan run did not complete: ${run.status}.`)
    }

    const updatedPlan = await updateContinuationPlanStatus(
      plan.id,
      run.status === 'complete' ? 'completed' : 'in_progress',
    )
    return {
      taskKind: 'continuation_plan',
      continuationPlanId: plan.id,
      continuationPlanStatus: updatedPlan.status,
      employeeRunId: run.id,
      employeeRunStatus: run.status,
      agentProfileId: plan.agentProfileId,
      sourceRunId: plan.sourceRunId,
    }
  } catch (err) {
    await updateContinuationPlanStatus(plan.id, 'open')
    throw err
  }
}

async function executeTaskBatchTask(item: TaskQueueItemRow): Promise<JsonObject> {
  return {
    taskKind: 'task_batch',
    taskBatchId: getString(item.payload, 'taskBatchId'),
    sourceItemIds: Array.isArray(item.payload.sourceItemIds) ? item.payload.sourceItemIds : [],
    taskCount: getNumber(item.payload, 'taskCount') ?? 0,
    benefits: getJsonObject(item.payload, 'benefits') ?? {},
    merged: true,
  }
}

async function finishTaskQueueItem(
  id: string,
  status: 'complete' | 'failed',
  result: JsonObject | null,
  error: string | null,
): Promise<TaskQueueItemRow> {
  await db
    .update(schema.taskQueueItems)
    .set({
      status,
      result,
      error,
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(schema.taskQueueItems.id, id))
  await recordAuditLog({
    actorType: 'system',
    action: status === 'complete' ? 'task_queue.complete' : 'task_queue.fail',
    resourceType: 'task_queue_item',
    resourceId: id,
    status: status === 'complete' ? 'allowed' : 'blocked',
    riskLevel: status === 'complete' ? 'low' : 'medium',
    message: error ?? 'Task queue item completed.',
    metadata: result ?? {},
  })
  return getRequiredTaskQueueItem(id)
}

async function getRequiredTaskQueue(id: string): Promise<TaskQueueRow> {
  const row = await db.query.taskQueues.findFirst({ where: eq(schema.taskQueues.id, id) })
  if (!row) throw new Error(`Task queue not found: ${id}`)
  return row
}

async function getRequiredTaskQueueItem(id: string): Promise<TaskQueueItemRow> {
  const row = await db.query.taskQueueItems.findFirst({
    where: eq(schema.taskQueueItems.id, id),
  })
  if (!row) throw new Error(`Task queue item not found: ${id}`)
  return row
}

async function hasPendingContinuationPlanTask(
  queueId: string,
  continuationPlanId: string,
): Promise<boolean> {
  const items = await db.query.taskQueueItems.findMany({
    where: and(
      eq(schema.taskQueueItems.queueId, queueId),
      inArray(schema.taskQueueItems.status, ['queued', 'running']),
    ),
    limit: 500,
  })
  return items.some(
    (item) =>
      item.kind === 'continuation_plan' &&
      getString(item.payload, 'continuationPlanId') === continuationPlanId,
  )
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined) return 1
  return Math.max(1, Math.min(32, Math.floor(value)))
}

function normalizeScanLimit(value: number | undefined): number {
  if (value === undefined) return 100
  return Math.max(1, Math.min(500, Math.floor(value)))
}

function normalizeIntervalMs(value: number): number {
  return Math.max(1_000, Math.min(30 * 24 * 60 * 60 * 1000, Math.floor(value)))
}

function normalizeRequired(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}

function getString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getNumber(obj: JsonObject, key: string): number | null {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getBoolean(obj: JsonObject, key: string): boolean | null {
  const value = obj[key]
  return typeof value === 'boolean' ? value : null
}

function getJsonObject(obj: JsonObject, key: string): JsonObject | null {
  const value = obj[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonObject
}

interface TaskResourceRequirement {
  resourceType: ResourceType
  resourceId: string
  ownerAgentId?: string
  ttlMs?: number
}

const resourceTypes = new Set<ResourceType>([
  'physical_mouse_keyboard',
  'browser_profile',
  'workspace_path',
  'file_path',
  'software_instance',
  'mobile_device',
  'network_profile',
])

function getResourceRequirements(payload: JsonObject): TaskResourceRequirement[] {
  const raw = payload.resourceRequirements
  if (!Array.isArray(raw)) return []
  const requirements: TaskResourceRequirement[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const obj = item as JsonObject
    const resourceType = getString(obj, 'resourceType')
    const resourceId = getString(obj, 'resourceId')
    if (!resourceType || !isResourceType(resourceType) || !resourceId) continue
    requirements.push({
      resourceType,
      resourceId,
      ownerAgentId: getString(obj, 'ownerAgentId') ?? undefined,
      ttlMs: getNumber(obj, 'ttlMs') ?? undefined,
    })
  }
  return requirements
}

function isResourceType(value: string): value is ResourceType {
  return resourceTypes.has(value as ResourceType)
}

function dedupeResourceRequirements(
  requirements: TaskResourceRequirement[],
): TaskResourceRequirement[] {
  const seen = new Set<string>()
  const unique: TaskResourceRequirement[] = []
  for (const requirement of requirements) {
    const key = `${requirement.resourceType}:${requirement.resourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(requirement)
  }
  return unique
}

function lockSummary(lock: ResourceLockRow): JsonObject {
  return {
    id: lock.id,
    resourceType: lock.resourceType,
    resourceId: lock.resourceId,
    ownerRunId: lock.ownerRunId,
    ownerAgentId: lock.ownerAgentId,
    status: lock.status,
    expiresAt: lock.expiresAt,
    releasedAt: lock.releasedAt,
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
