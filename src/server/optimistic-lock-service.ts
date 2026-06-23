import { createHash } from 'node:crypto'

import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ConfigEntityType,
  ConfigVersionRow,
  EditConflictResolution,
  EditConflictRow,
  JsonObject,
  OptimisticLockRow,
} from '@/db/schema'
import { captureConfigVersion } from '@/server/config-version-service'
import { newConfigVersionId, newEditConflictId, newOptimisticLockId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface StartOptimisticEditArgs {
  entityType: ConfigEntityType
  entityId: string
  editedBy?: string | null
}

export interface CommitOptimisticEditArgs extends StartOptimisticEditArgs {
  baseVersion: number
  proposedSnapshot: JsonObject
  changedFields?: string[]
}

export interface CommitOptimisticEditResult {
  status: 'committed' | 'conflict'
  lock: OptimisticLockRow
  conflict: EditConflictRow | null
  configVersion: ConfigVersionRow | null
}

export interface ResolveEditConflictArgs {
  resolution: EditConflictResolution
  mergedSnapshot?: JsonObject | null
  resolvedBy?: string | null
}

export async function startOptimisticEdit(
  args: StartOptimisticEditArgs,
): Promise<OptimisticLockRow> {
  const existing = await findLock(args.entityType, args.entityId)
  if (existing) return existing

  const baseline = await captureConfigVersion({
    entityType: args.entityType,
    entityId: args.entityId,
    source: 'runtime_snapshot',
    changeSummary: 'Optimistic edit baseline snapshot.',
    createdBy: args.editedBy ?? null,
  })
  const now = Date.now()
  const row: OptimisticLockRow = {
    id: newOptimisticLockId(),
    entityType: args.entityType,
    entityId: args.entityId,
    displayName: baseline.displayName,
    entityVersion: baseline.version,
    snapshot: baseline.snapshot,
    contentHash: baseline.contentHash,
    updatedBy: args.editedBy?.trim() || null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.optimisticLocks).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'optimistic_lock.start',
    resourceType: args.entityType,
    resourceId: args.entityId,
    riskLevel: 'low',
    message: `Optimistic edit session started for ${args.entityType}:${args.entityId}.`,
    metadata: { lockId: row.id, entityVersion: row.entityVersion },
  })
  return row
}

export async function commitOptimisticEdit(
  args: CommitOptimisticEditArgs,
): Promise<CommitOptimisticEditResult> {
  const lock = await startOptimisticEdit(args)
  if (args.baseVersion !== lock.entityVersion) {
    const conflict = await createEditConflict(lock, args)
    await recordAuditLog({
      actorType: 'system',
      action: 'optimistic_lock.conflict',
      resourceType: args.entityType,
      resourceId: args.entityId,
      status: 'warning',
      riskLevel: 'medium',
      message: `Edit conflict on ${args.entityType}:${args.entityId}; client v${args.baseVersion}, server v${lock.entityVersion}.`,
      metadata: {
        lockId: lock.id,
        conflictId: conflict.id,
        conflictingFields: conflict.conflictingFields,
      },
    })
    return { status: 'conflict', lock, conflict, configVersion: null }
  }

  const nextVersion = lock.entityVersion + 1
  const contentHash = hashConfig(args.proposedSnapshot)
  const now = Date.now()
  const configVersion = await createOptimisticConfigVersion({
    entityType: args.entityType,
    entityId: args.entityId,
    displayName: lock.displayName,
    version: nextVersion,
    snapshot: args.proposedSnapshot,
    contentHash,
    createdBy: args.editedBy ?? null,
  })
  const updated: OptimisticLockRow = {
    ...lock,
    entityVersion: nextVersion,
    snapshot: args.proposedSnapshot,
    contentHash,
    updatedBy: args.editedBy?.trim() || null,
    updatedAt: now,
  }
  await db
    .update(schema.optimisticLocks)
    .set({
      entityVersion: updated.entityVersion,
      snapshot: updated.snapshot,
      contentHash: updated.contentHash,
      updatedBy: updated.updatedBy,
      updatedAt: updated.updatedAt,
    })
    .where(eq(schema.optimisticLocks.id, lock.id))
  await recordAuditLog({
    actorType: 'system',
    action: 'optimistic_lock.commit',
    resourceType: args.entityType,
    resourceId: args.entityId,
    riskLevel: 'low',
    message: `Optimistic edit committed for ${args.entityType}:${args.entityId} v${nextVersion}.`,
    metadata: { lockId: lock.id, configVersionId: configVersion.id },
  })
  return { status: 'committed', lock: updated, conflict: null, configVersion }
}

export async function listOptimisticLocks(args: {
  entityType?: ConfigEntityType
  entityId?: string
  limit?: number
} = {}): Promise<OptimisticLockRow[]> {
  const rows = await db.query.optimisticLocks.findMany({
    orderBy: [desc(schema.optimisticLocks.updatedAt)],
    limit: args.limit ?? 100,
  })
  return rows.filter((row) => {
    if (args.entityType && row.entityType !== args.entityType) return false
    if (args.entityId && row.entityId !== args.entityId) return false
    return true
  })
}

export async function listEditConflicts(args: {
  entityType?: ConfigEntityType
  entityId?: string
  status?: EditConflictRow['status']
  limit?: number
} = {}): Promise<EditConflictRow[]> {
  const rows = await db.query.editConflicts.findMany({
    orderBy: [desc(schema.editConflicts.createdAt)],
    limit: args.limit ?? 100,
  })
  return rows.filter((row) => {
    if (args.entityType && row.entityType !== args.entityType) return false
    if (args.entityId && row.entityId !== args.entityId) return false
    if (args.status && row.status !== args.status) return false
    return true
  })
}

export async function resolveEditConflict(
  conflictId: string,
  args: ResolveEditConflictArgs,
): Promise<EditConflictRow> {
  const row = await db.query.editConflicts.findFirst({
    where: eq(schema.editConflicts.id, conflictId),
  })
  if (!row) throw new Error(`Edit conflict not found: ${conflictId}`)
  const mergedSnapshot =
    args.resolution === 'merge' || args.resolution === 'overwrite'
      ? args.mergedSnapshot ?? row.yourSnapshot
      : args.resolution === 'discard'
        ? row.serverSnapshot
        : row.mergedSnapshot
  const updated: EditConflictRow = {
    ...row,
    resolution: args.resolution,
    status: 'resolved',
    mergedSnapshot,
    resolvedBy: args.resolvedBy?.trim() || null,
    resolvedAt: Date.now(),
  }
  await db
    .update(schema.editConflicts)
    .set({
      resolution: updated.resolution,
      status: updated.status,
      mergedSnapshot: updated.mergedSnapshot,
      resolvedBy: updated.resolvedBy,
      resolvedAt: updated.resolvedAt,
    })
    .where(eq(schema.editConflicts.id, conflictId))
  await recordAuditLog({
    actorType: 'system',
    action: 'optimistic_lock.resolve_conflict',
    resourceType: row.entityType,
    resourceId: row.entityId,
    riskLevel: args.resolution === 'overwrite' ? 'medium' : 'low',
    message: `Edit conflict ${conflictId} resolved as ${args.resolution}.`,
    metadata: { conflictId, resolution: args.resolution },
  })
  return updated
}

async function findLock(
  entityType: ConfigEntityType,
  entityId: string,
): Promise<OptimisticLockRow | null> {
  return (
    (await db.query.optimisticLocks.findFirst({
      where: and(
        eq(schema.optimisticLocks.entityType, entityType),
        eq(schema.optimisticLocks.entityId, entityId),
      ),
      orderBy: [desc(schema.optimisticLocks.updatedAt)],
    })) ?? null
  )
}

async function createEditConflict(
  lock: OptimisticLockRow,
  args: CommitOptimisticEditArgs,
): Promise<EditConflictRow> {
  const row: EditConflictRow = {
    id: newEditConflictId(),
    lockId: lock.id,
    entityType: args.entityType,
    entityId: args.entityId,
    yourVersion: args.baseVersion,
    serverVersion: lock.entityVersion,
    conflictingFields: conflictingFields(lock.snapshot, args.proposedSnapshot, args.changedFields),
    yourSnapshot: args.proposedSnapshot,
    serverSnapshot: lock.snapshot,
    mergedSnapshot: null,
    resolution: 'show_diff',
    status: 'open',
    resolvedBy: null,
    createdAt: Date.now(),
    resolvedAt: null,
  }
  await db.insert(schema.editConflicts).values(row)
  return row
}

async function createOptimisticConfigVersion(args: {
  entityType: ConfigEntityType
  entityId: string
  displayName: string
  version: number
  snapshot: JsonObject
  contentHash: string
  createdBy: string | null
}): Promise<ConfigVersionRow> {
  const row: ConfigVersionRow = {
    id: newConfigVersionId(),
    entityType: args.entityType,
    entityId: args.entityId,
    version: args.version,
    displayName: args.displayName,
    source: 'api',
    snapshot: args.snapshot,
    contentHash: args.contentHash,
    changeSummary: 'Optimistic edit committed with matching entity version.',
    createdBy: args.createdBy?.trim() || null,
    createdAt: Date.now(),
  }
  await db.insert(schema.configVersions).values(row)
  return row
}

function conflictingFields(
  serverSnapshot: JsonObject,
  proposedSnapshot: JsonObject,
  changedFields: string[] | undefined,
): string[] {
  const candidateFields = changedFields?.length
    ? changedFields
    : Array.from(new Set([...Object.keys(serverSnapshot), ...Object.keys(proposedSnapshot)]))
  return candidateFields.filter((field) => {
    const serverValue = (serverSnapshot as Record<string, unknown>)[field]
    const proposedValue = (proposedSnapshot as Record<string, unknown>)[field]
    return stableStringify(serverValue) !== stableStringify(proposedValue)
  })
}

function hashConfig(value: JsonObject): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
      .join(',')}}`
  }
  return value === undefined ? 'undefined' : (JSON.stringify(value) ?? 'null')
}
