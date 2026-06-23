import { and, desc, eq, lte } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { ResourceLockRow } from '@/db/schema'
import { newResourceLockId } from '@/server/ids'

export interface AcquireResourceLockArgs {
  resourceType: ResourceLockRow['resourceType']
  resourceId: string
  ownerRunId: string
  ownerAgentId: string
  ttlMs?: number
}

export async function acquireResourceLock(args: AcquireResourceLockArgs): Promise<ResourceLockRow> {
  const now = Date.now()
  await expireResourceLocks(now)
  const existing = await db.query.resourceLocks.findFirst({
    where: and(
      eq(schema.resourceLocks.resourceType, args.resourceType),
      eq(schema.resourceLocks.resourceId, args.resourceId),
      eq(schema.resourceLocks.status, 'held'),
    ),
  })
  if (existing) {
    throw new Error(`Resource is already locked: ${args.resourceType}:${args.resourceId}`)
  }
  const row = {
    id: newResourceLockId(),
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    ownerRunId: args.ownerRunId,
    ownerAgentId: args.ownerAgentId,
    status: 'held' as const,
    createdAt: now,
    expiresAt: now + (args.ttlMs ?? 15 * 60 * 1000),
    releasedAt: null,
  }
  await db.insert(schema.resourceLocks).values(row)
  return row
}

export async function releaseResourceLock(id: string): Promise<ResourceLockRow> {
  const now = Date.now()
  const lock = await db.query.resourceLocks.findFirst({ where: eq(schema.resourceLocks.id, id) })
  if (!lock) throw new Error(`Resource lock not found: ${id}`)
  await db
    .update(schema.resourceLocks)
    .set({ status: 'released', releasedAt: now })
    .where(eq(schema.resourceLocks.id, id))
  const updated = await db.query.resourceLocks.findFirst({ where: eq(schema.resourceLocks.id, id) })
  if (!updated) throw new Error(`Resource lock missing after release: ${id}`)
  return updated
}

export async function releaseResourceLocks(ids: string[]): Promise<ResourceLockRow[]> {
  const released: ResourceLockRow[] = []
  for (const id of ids) {
    released.push(await releaseResourceLock(id))
  }
  return released
}

export async function expireResourceLocks(now = Date.now()): Promise<void> {
  await db
    .update(schema.resourceLocks)
    .set({ status: 'expired', releasedAt: now })
    .where(and(eq(schema.resourceLocks.status, 'held'), lte(schema.resourceLocks.expiresAt, now)))
}

export async function listResourceLocksForRun(ownerRunId: string): Promise<ResourceLockRow[]> {
  return db.query.resourceLocks.findMany({
    where: eq(schema.resourceLocks.ownerRunId, ownerRunId),
    orderBy: [desc(schema.resourceLocks.createdAt)],
  })
}
