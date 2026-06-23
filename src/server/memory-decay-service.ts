import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  MemoryDecayAction,
  MemoryDecayPoint,
  MemoryDecaySnapshotRow,
  MemoryDecayStatus,
  MemoryItemRow,
  MemoryScope,
  MemoryType,
} from '@/db/schema'
import { newMemoryDecaySnapshotId } from '@/server/ids'

const DAY_MS = 24 * 60 * 60 * 1000

export interface CreateMemoryDecaySnapshotArgs {
  name?: string
  agentProfileId?: string | null
  includeExpired?: boolean
  horizonDays?: number
  staleAfterDays?: number
  expiringSoonDays?: number
  pinnedImportanceThreshold?: number
  filters?: {
    scope?: MemoryScope
    type?: MemoryType
    query?: string
    limit?: number
  }
}

export interface ApplyMemoryDecayActionArgs {
  memoryItemId: string
  action: MemoryDecayAction
  confirm?: boolean
  patch?: {
    title?: string
    content?: string
    importance?: number
    expiresAt?: number | null
  }
}

export async function createMemoryDecaySnapshot(
  args: CreateMemoryDecaySnapshotArgs = {},
): Promise<MemoryDecaySnapshotRow> {
  const now = Date.now()
  const horizonDays = clampInt(args.horizonDays ?? 180, 1, 3650)
  const staleAfterDays = clampInt(args.staleAfterDays ?? 45, 1, 3650)
  const expiringSoonDays = clampInt(args.expiringSoonDays ?? 30, 1, 3650)
  const pinnedImportanceThreshold = clampNumber(args.pinnedImportanceThreshold ?? 0.95, 0, 1)
  const memories = await selectMemories(args, now)
  const points = memories.map((memory) =>
    buildDecayPoint(memory, {
      now,
      horizonDays,
      staleAfterDays,
      expiringSoonDays,
      pinnedImportanceThreshold,
    }),
  )
  const summary = buildSummary(points)
  const row = {
    id: newMemoryDecaySnapshotId(),
    name: args.name?.trim() || 'Memory Decay View',
    agentProfileId: normalizeOptional(args.agentProfileId),
    includeExpired: args.includeExpired ?? false,
    filters: sanitizeFilters(args.filters ?? {}),
    horizonDays,
    staleAfterDays,
    expiringSoonDays,
    pinnedImportanceThreshold,
    points,
    summary,
    actionResult: {},
    pointCount: points.length,
    status: 'generated' as const,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.memoryDecaySnapshots).values(row)
  return row
}

export async function listMemoryDecaySnapshots(args: {
  agentProfileId?: string
  limit?: number
} = {}): Promise<MemoryDecaySnapshotRow[]> {
  const conditions: SQL[] = []
  if (args.agentProfileId) conditions.push(eq(schema.memoryDecaySnapshots.agentProfileId, args.agentProfileId))
  return db.query.memoryDecaySnapshots.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.memoryDecaySnapshots.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function getMemoryDecaySnapshot(id: string): Promise<MemoryDecaySnapshotRow> {
  return getRequiredMemoryDecaySnapshot(id)
}

export async function applyMemoryDecayAction(
  snapshotId: string,
  args: ApplyMemoryDecayActionArgs,
): Promise<MemoryDecaySnapshotRow> {
  const snapshot = await getRequiredMemoryDecaySnapshot(snapshotId)
  const memory = await getRequiredMemoryItem(args.memoryItemId)
  const now = Date.now()
  const actionResult: JsonObject = {
    action: args.action,
    memoryItemId: memory.id,
    title: memory.title,
    requestedAt: now,
    confirmed: args.confirm ?? false,
  }

  if (args.action === 'pin') {
    await db
      .update(schema.memoryItems)
      .set({ importance: 1, expiresAt: null, updatedAt: now })
      .where(eq(schema.memoryItems.id, memory.id))
    actionResult.applied = true
    actionResult.message = 'Memory pinned and removed from automatic expiry.'
  } else if (args.action === 'update_content') {
    const patch = args.patch ?? {}
    await db
      .update(schema.memoryItems)
      .set({
        title: patch.title?.trim() || memory.title,
        content: patch.content?.trim() || memory.content,
        importance: patch.importance ?? memory.importance,
        expiresAt: patch.expiresAt === undefined ? memory.expiresAt : patch.expiresAt,
        updatedAt: now,
      })
      .where(eq(schema.memoryItems.id, memory.id))
    actionResult.applied = true
    actionResult.message = 'Memory content refreshed.'
  } else if (args.confirm) {
    await db.delete(schema.memoryItems).where(eq(schema.memoryItems.id, memory.id))
    actionResult.applied = true
    actionResult.deleted = true
    actionResult.message = 'Memory deleted after explicit confirmation.'
  } else {
    actionResult.applied = false
    actionResult.requiresConfirmation = true
    actionResult.message = 'Delete action planned only; send confirm=true to delete.'
  }

  await db
    .update(schema.memoryDecaySnapshots)
    .set({
      status: actionResult.applied ? 'action_applied' : 'action_planned',
      actionResult,
      updatedAt: now,
    })
    .where(eq(schema.memoryDecaySnapshots.id, snapshot.id))

  return getRequiredMemoryDecaySnapshot(snapshot.id)
}

async function selectMemories(
  args: CreateMemoryDecaySnapshotArgs,
  now: number,
): Promise<MemoryItemRow[]> {
  const rows = await db.query.memoryItems.findMany({
    orderBy: [desc(schema.memoryItems.importance), desc(schema.memoryItems.updatedAt)],
    limit: 500,
  })
  const query = args.filters?.query?.trim().toLowerCase()
  const limit = clampInt(args.filters?.limit ?? 120, 1, 500)
  return rows
    .filter((memory) => {
      if (args.agentProfileId && memory.agentProfileId && memory.agentProfileId !== args.agentProfileId) {
        return false
      }
      if (!args.includeExpired && memory.expiresAt && memory.expiresAt <= now) return false
      if (args.filters?.scope && memory.scope !== args.filters.scope) return false
      if (args.filters?.type && memory.type !== args.filters.type) return false
      if (query) {
        const haystack = `${memory.title}\n${memory.content}\n${memory.type}\n${memory.scope}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
    .slice(0, limit)
}

function buildDecayPoint(
  memory: MemoryItemRow,
  config: {
    now: number
    horizonDays: number
    staleAfterDays: number
    expiringSoonDays: number
    pinnedImportanceThreshold: number
  },
): MemoryDecayPoint {
  const ageDays = daysBetween(config.now, memory.createdAt)
  const daysSinceUpdated = daysBetween(config.now, memory.updatedAt)
  const expiresInDays = memory.expiresAt ? Math.ceil((memory.expiresAt - config.now) / DAY_MS) : null
  const status = resolveStatus(memory, daysSinceUpdated, expiresInDays, config)
  const lineStyle = status === 'pinned' ? 'solid' : 'dashed'
  const marker = status === 'expiring_soon' || status === 'expired' ? 'square' : 'circle'
  const x = round(clampNumber(daysSinceUpdated / config.horizonDays, 0, 1), 4)
  const y = round(clampNumber(memory.importance, 0, 1), 4)
  return {
    memoryItemId: memory.id,
    title: memory.title,
    type: memory.type,
    scope: memory.scope,
    agentProfileId: memory.agentProfileId,
    importance: round(memory.importance, 4),
    confidence: round(memory.confidence, 4),
    ageDays,
    daysSinceUpdated,
    expiresInDays,
    x,
    y,
    status,
    lineStyle,
    marker,
    colorRole: colorRole(memory.importance, status),
    detailText: detailText(memory, daysSinceUpdated, expiresInDays),
    actionSuggestions: actionSuggestions(status),
  }
}

function resolveStatus(
  memory: MemoryItemRow,
  daysSinceUpdated: number,
  expiresInDays: number | null,
  config: {
    staleAfterDays: number
    expiringSoonDays: number
    pinnedImportanceThreshold: number
  },
): MemoryDecayStatus {
  if (expiresInDays !== null && expiresInDays <= 0) return 'expired'
  if (expiresInDays !== null && expiresInDays <= config.expiringSoonDays) return 'expiring_soon'
  if (memory.importance >= config.pinnedImportanceThreshold && !memory.expiresAt) return 'pinned'
  if (daysSinceUpdated >= config.staleAfterDays || memory.expiresAt) return 'decaying'
  return 'fresh'
}

function detailText(
  memory: MemoryItemRow,
  daysSinceUpdated: number,
  expiresInDays: number | null,
): string {
  const expiry =
    expiresInDays === null
      ? '当前不会自动过期。'
      : expiresInDays <= 0
        ? '已经到期。'
        : `将在 ${expiresInDays} 天后过期。`
  return `这条记忆 [${memory.title}] 已 ${daysSinceUpdated} 天未被更新，${expiry}`
}

function actionSuggestions(status: MemoryDecayStatus): MemoryDecayAction[] {
  if (status === 'pinned') return ['update_content']
  if (status === 'expired' || status === 'expiring_soon') return ['pin', 'delete_now', 'update_content']
  return ['pin', 'update_content']
}

function colorRole(
  importance: number,
  status: MemoryDecayStatus,
): MemoryDecayPoint['colorRole'] {
  if (status === 'expired') return 'expired'
  if (status === 'expiring_soon') return 'expiring'
  if (importance >= 0.85) return 'core'
  if (importance >= 0.55) return 'important'
  return 'temporary'
}

function buildSummary(points: MemoryDecayPoint[]): JsonObject {
  const byStatus = new Map<MemoryDecayStatus, number>()
  for (const point of points) byStatus.set(point.status, (byStatus.get(point.status) ?? 0) + 1)
  const expiringSoon = byStatus.get('expiring_soon') ?? 0
  const expired = byStatus.get('expired') ?? 0
  const oldestDays = points.reduce((max, point) => Math.max(max, point.daysSinceUpdated), 0)
  return {
    total: points.length,
    pinned: byStatus.get('pinned') ?? 0,
    fresh: byStatus.get('fresh') ?? 0,
    decaying: byStatus.get('decaying') ?? 0,
    expiringSoon,
    expired,
    cleanupCandidates: expiringSoon + expired,
    averageImportance: points.length
      ? round(points.reduce((sum, point) => sum + point.importance, 0) / points.length, 4)
      : 0,
    oldestDays,
    legend: {
      solid: '固定记忆',
      dashed: '衰减中',
      square: '即将被清理',
    },
  }
}

async function getRequiredMemoryDecaySnapshot(id: string): Promise<MemoryDecaySnapshotRow> {
  const row = await db.query.memoryDecaySnapshots.findFirst({
    where: eq(schema.memoryDecaySnapshots.id, id),
  })
  if (!row) throw new Error(`Memory decay snapshot not found: ${id}`)
  return row
}

async function getRequiredMemoryItem(id: string): Promise<MemoryItemRow> {
  const row = await db.query.memoryItems.findFirst({ where: eq(schema.memoryItems.id, id) })
  if (!row) throw new Error(`Memory item not found: ${id}`)
  return row
}

function sanitizeFilters(filters: NonNullable<CreateMemoryDecaySnapshotArgs['filters']>): JsonObject {
  const next: JsonObject = {}
  if (filters.scope) next.scope = filters.scope
  if (filters.type) next.type = filters.type
  if (filters.query?.trim()) next.query = filters.query.trim()
  if (filters.limit) next.limit = filters.limit
  return next
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function daysBetween(now: number, then: number): number {
  return Math.max(0, Math.floor((now - then) / DAY_MS))
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
