import { createHash } from 'node:crypto'

import { and, asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  EmployeeRunEventRow,
  EmployeeRunRow,
  IdempotencyRecordRow,
  JsonObject,
  RecoveryEventRow,
  RecoveryEventStatus,
  RecoveryEventType,
  RuntimeCheckpointRow,
  RuntimeContextSnapshotRow,
} from '@/db/schema'
import { newIdempotencyRecordId, newRecoveryEventId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface RecordRecoveryEventArgs {
  resourceType: string
  resourceId: string
  eventType: RecoveryEventType
  status?: RecoveryEventStatus
  summary: string
  payload?: JsonObject
}

export async function recordRecoveryEvent(
  args: RecordRecoveryEventArgs,
): Promise<RecoveryEventRow> {
  const row: RecoveryEventRow = {
    id: newRecoveryEventId(),
    resourceType: normalizeRequired(args.resourceType, 'resourceType'),
    resourceId: normalizeRequired(args.resourceId, 'resourceId'),
    eventType: args.eventType,
    status: args.status ?? 'recorded',
    summary: normalizeRequired(args.summary, 'summary'),
    payload: args.payload ?? {},
    createdAt: Date.now(),
  }
  await db.insert(schema.recoveryEvents).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: `recovery.${row.eventType}`,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    riskLevel: row.status === 'failed' ? 'medium' : 'low',
    status: row.status === 'failed' ? 'warning' : 'allowed',
    message: row.summary,
    metadata: { recoveryEventId: row.id },
  })
  return row
}

export async function listRecoveryEvents(args: {
  resourceType?: string
  resourceId?: string
} = {}): Promise<RecoveryEventRow[]> {
  const where =
    args.resourceType && args.resourceId
      ? and(
          eq(schema.recoveryEvents.resourceType, args.resourceType),
          eq(schema.recoveryEvents.resourceId, args.resourceId),
        )
      : undefined
  return db.query.recoveryEvents.findMany({
    where,
    orderBy: [desc(schema.recoveryEvents.createdAt)],
    limit: 100,
  })
}

export interface CreateIdempotencyRecordArgs {
  key: string
  scope?: string
  resourceType: string
  resourceId?: string | null
  request: JsonObject
  expiresAt?: number | null
}

export async function createIdempotencyRecord(
  args: CreateIdempotencyRecordArgs,
): Promise<IdempotencyRecordRow> {
  const key = normalizeRequired(args.key, 'key')
  const requestHash = hashJson(args.request)
  const existing = await db.query.idempotencyRecords.findFirst({
    where: eq(schema.idempotencyRecords.key, key),
  })
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new Error('Idempotency key already exists for a different request.')
    }
    return existing
  }

  const now = Date.now()
  const row: IdempotencyRecordRow = {
    id: newIdempotencyRecordId(),
    key,
    scope: args.scope?.trim() || 'global',
    resourceType: normalizeRequired(args.resourceType, 'resourceType'),
    resourceId: normalizeNullable(args.resourceId),
    requestHash,
    status: 'started',
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: args.expiresAt ?? null,
  }
  await db.insert(schema.idempotencyRecords).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'idempotency.start',
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    message: `Idempotency record ${row.key} started.`,
    metadata: { idempotencyRecordId: row.id, scope: row.scope },
  })
  return row
}

export async function completeIdempotencyRecord(
  key: string,
  result: JsonObject,
): Promise<IdempotencyRecordRow> {
  return finishIdempotencyRecord(key, 'completed', result, null)
}

export async function failIdempotencyRecord(
  key: string,
  error: string,
): Promise<IdempotencyRecordRow> {
  return finishIdempotencyRecord(key, 'failed', null, error)
}

export async function listIdempotencyRecords(limit = 100): Promise<IdempotencyRecordRow[]> {
  return db.query.idempotencyRecords.findMany({
    orderBy: [desc(schema.idempotencyRecords.createdAt)],
    limit: Math.min(Math.max(limit, 1), 500),
  })
}

export interface EmployeeRunRecoverySummary {
  run: EmployeeRunRow
  latestCheckpoint: RuntimeCheckpointRow | null
  contextSnapshots: RuntimeContextSnapshotRow[]
  runtimeEvents: EmployeeRunEventRow[]
  recoveryEvents: RecoveryEventRow[]
  canResume: boolean
  summary: string
}

export async function getEmployeeRunRecoverySummary(
  runId: string,
): Promise<EmployeeRunRecoverySummary> {
  const run = await getRequiredEmployeeRun(runId)
  const latestCheckpoint =
    (await db.query.runtimeCheckpoints.findFirst({
      where: eq(schema.runtimeCheckpoints.employeeRunId, runId),
      orderBy: [desc(schema.runtimeCheckpoints.stepIndex)],
    })) ?? null
  const contextSnapshots = await db.query.runtimeContextSnapshots.findMany({
    where: eq(schema.runtimeContextSnapshots.employeeRunId, runId),
    orderBy: [asc(schema.runtimeContextSnapshots.createdAt)],
  })
  const runtimeEvents = await db.query.employeeRunEvents.findMany({
    where: eq(schema.employeeRunEvents.employeeRunId, runId),
    orderBy: [asc(schema.employeeRunEvents.createdAt)],
  })
  const recoveryEvents = await listRecoveryEvents({
    resourceType: 'employee_run',
    resourceId: runId,
  })
  const canResume = ['queued', 'running', 'paused', 'failed'].includes(run.status)
  return {
    run,
    latestCheckpoint,
    contextSnapshots,
    runtimeEvents,
    recoveryEvents,
    canResume,
    summary: buildRecoverySummary(run, latestCheckpoint, contextSnapshots.length, recoveryEvents.length),
  }
}

async function finishIdempotencyRecord(
  key: string,
  status: 'completed' | 'failed',
  result: JsonObject | null,
  error: string | null,
): Promise<IdempotencyRecordRow> {
  const existing = await db.query.idempotencyRecords.findFirst({
    where: eq(schema.idempotencyRecords.key, key),
  })
  if (!existing) throw new Error(`Idempotency record not found: ${key}`)
  await db
    .update(schema.idempotencyRecords)
    .set({
      status,
      result,
      error,
      updatedAt: Date.now(),
    })
    .where(eq(schema.idempotencyRecords.key, key))
  await recordAuditLog({
    actorType: 'system',
    action: status === 'completed' ? 'idempotency.complete' : 'idempotency.fail',
    resourceType: existing.resourceType,
    resourceId: existing.resourceId,
    status: status === 'completed' ? 'allowed' : 'warning',
    riskLevel: status === 'completed' ? 'low' : 'medium',
    message: error ?? `Idempotency record ${key} completed.`,
    metadata: { idempotencyRecordId: existing.id },
  })
  const updated = await db.query.idempotencyRecords.findFirst({
    where: eq(schema.idempotencyRecords.key, key),
  })
  if (!updated) throw new Error(`Idempotency record missing after update: ${key}`)
  return updated
}

async function getRequiredEmployeeRun(runId: string): Promise<EmployeeRunRow> {
  const run = await db.query.employeeRuns.findFirst({
    where: eq(schema.employeeRuns.id, runId),
  })
  if (!run) throw new Error(`Employee run not found: ${runId}`)
  return run
}

function buildRecoverySummary(
  run: EmployeeRunRow,
  checkpoint: RuntimeCheckpointRow | null,
  contextSnapshotCount: number,
  recoveryEventCount: number,
): string {
  const checkpointPart = checkpoint
    ? `latest checkpoint ${checkpoint.phase}#${checkpoint.stepIndex}`
    : 'no checkpoint'
  return `Run ${run.id} is ${run.status}; ${checkpointPart}; ${contextSnapshotCount} context snapshots; ${recoveryEventCount} recovery events.`
}

function hashJson(value: JsonObject): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
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
