import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  NotificationChannel,
  NotificationLevel,
  NotificationPreferenceRow,
  NotificationRow,
} from '@/db/schema'
import { newNotificationId, newNotificationPreferenceId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateNotificationArgs {
  channel?: NotificationChannel
  level?: NotificationLevel
  sourceType: string
  sourceId?: string | null
  title: string
  message?: string
  payload?: JsonObject
}

export async function createNotification(args: CreateNotificationArgs): Promise<NotificationRow> {
  const row: NotificationRow = {
    id: newNotificationId(),
    channel: args.channel ?? 'in_app',
    level: args.level ?? 'info',
    sourceType: normalizeRequired(args.sourceType, 'sourceType'),
    sourceId: normalizeNullable(args.sourceId),
    title: normalizeRequired(args.title, 'title'),
    message: args.message?.trim() ?? '',
    payload: args.payload ?? {},
    status: 'unread',
    createdAt: Date.now(),
    readAt: null,
  }
  await db.insert(schema.notifications).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'notification.create',
    resourceType: 'notification',
    resourceId: row.id,
    riskLevel: row.level === 'critical' ? 'high' : row.level === 'warning' ? 'medium' : 'low',
    status: row.level === 'critical' ? 'warning' : 'allowed',
    message: row.title,
    metadata: { sourceType: row.sourceType, sourceId: row.sourceId, channel: row.channel },
  })
  return row
}

export async function listNotifications(
  status?: NotificationRow['status'],
): Promise<NotificationRow[]> {
  return db.query.notifications.findMany({
    where: status ? eq(schema.notifications.status, status) : undefined,
    orderBy: [desc(schema.notifications.createdAt)],
    limit: 100,
  })
}

export async function markNotificationRead(id: string): Promise<NotificationRow> {
  await db
    .update(schema.notifications)
    .set({ status: 'read', readAt: Date.now() })
    .where(eq(schema.notifications.id, id))
  const row = await db.query.notifications.findFirst({ where: eq(schema.notifications.id, id) })
  if (!row) throw new Error(`Notification not found: ${id}`)
  return row
}

export interface UpsertNotificationPreferenceArgs {
  channel: NotificationChannel
  enabled?: boolean
  minLevel?: NotificationLevel
}

export async function upsertNotificationPreference(
  args: UpsertNotificationPreferenceArgs,
): Promise<NotificationPreferenceRow> {
  const existing = await db.query.notificationPreferences.findFirst({
    where: eq(schema.notificationPreferences.channel, args.channel),
  })
  const now = Date.now()
  if (existing) {
    await db
      .update(schema.notificationPreferences)
      .set({
        enabled: args.enabled ?? existing.enabled,
        minLevel: args.minLevel ?? existing.minLevel,
        updatedAt: now,
      })
      .where(eq(schema.notificationPreferences.id, existing.id))
    const updated = await db.query.notificationPreferences.findFirst({
      where: eq(schema.notificationPreferences.id, existing.id),
    })
    if (!updated) throw new Error(`Notification preference missing after update: ${existing.id}`)
    return updated
  }
  const row: NotificationPreferenceRow = {
    id: newNotificationPreferenceId(),
    channel: args.channel,
    enabled: args.enabled ?? true,
    minLevel: args.minLevel ?? 'info',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.notificationPreferences).values(row)
  return row
}

export async function listNotificationPreferences(): Promise<NotificationPreferenceRow[]> {
  return db.query.notificationPreferences.findMany({
    orderBy: [desc(schema.notificationPreferences.createdAt)],
  })
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
