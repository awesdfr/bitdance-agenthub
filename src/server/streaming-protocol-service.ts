import { and, asc, desc, eq, gt } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  OpenSourceGovernanceStatus,
  StreamProtocolChannelRow,
  StreamProtocolEventRow,
  StreamProtocolMessageType,
  StreamProtocolTransport,
  StreamReplayCursorRow,
} from '@/db/schema'
import {
  newStreamProtocolChannelId,
  newStreamProtocolEventId,
  newStreamReplayCursorId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateStreamProtocolChannelArgs {
  stream: string
  description?: string
  primaryTransport?: StreamProtocolTransport
  fallbackTransport?: StreamProtocolTransport
  replayRetentionMs?: number
  status?: OpenSourceGovernanceStatus
}

export interface PublishStreamProtocolEventArgs {
  stream: string
  messageType: StreamProtocolMessageType
  data?: JsonObject
}

export interface RecordStreamReplayCursorArgs {
  stream: string
  clientId: string
  lastSequence?: number
  transport?: StreamProtocolTransport
  disconnectedAt?: number | null
}

export interface StreamReplayResult {
  cursor: StreamReplayCursorRow
  events: StreamProtocolEventRow[]
}

const defaultChannels: CreateStreamProtocolChannelArgs[] = [
  {
    stream: 'agent.{agentId}.run.{runId}',
    description: 'Per-Agent run stream for runtime events and step progress.',
  },
  {
    stream: 'canvas.{canvasId}',
    description: 'Canvas workflow stream for node status, graph updates, and run progress.',
  },
  {
    stream: 'system.notifications',
    description: 'System notification stream for approvals, alerts, and user attention.',
  },
  {
    stream: 'agent.{agentId}.debug',
    description: 'Agent debug stream for diagnostics, replay snapshots, and live inspection.',
  },
]

export async function createStreamProtocolChannel(
  args: CreateStreamProtocolChannelArgs,
): Promise<StreamProtocolChannelRow> {
  const now = Date.now()
  const row: StreamProtocolChannelRow = {
    id: newStreamProtocolChannelId(),
    stream: args.stream.trim(),
    description: args.description?.trim() ?? '',
    primaryTransport: args.primaryTransport ?? 'websocket',
    fallbackTransport: args.fallbackTransport ?? 'sse',
    replayRetentionMs: args.replayRetentionMs ?? 3600000,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.streamProtocolChannels).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'stream_protocol.channel.create',
    resourceType: 'stream_protocol_channel',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `${row.stream} stream protocol registered.`,
    metadata: channelSnapshot(row),
  })
  return row
}

export async function listStreamProtocolChannels(args: {
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<StreamProtocolChannelRow[]> {
  return db.query.streamProtocolChannels.findMany({
    where: args.status ? eq(schema.streamProtocolChannels.status, args.status) : undefined,
    orderBy: [asc(schema.streamProtocolChannels.stream)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function publishStreamProtocolEvent(
  args: PublishStreamProtocolEventArgs,
): Promise<StreamProtocolEventRow> {
  const channel = await resolveStreamChannel(args.stream)
  const previous = await db.query.streamProtocolEvents.findFirst({
    where: eq(schema.streamProtocolEvents.stream, channel.stream),
    orderBy: [desc(schema.streamProtocolEvents.sequence)],
  })
  const row: StreamProtocolEventRow = {
    id: newStreamProtocolEventId(),
    channelId: channel.id,
    stream: channel.stream,
    sequence: (previous?.sequence ?? 0) + 1,
    messageType: args.messageType,
    data: args.data ?? {},
    createdAt: Date.now(),
  }
  await db.insert(schema.streamProtocolEvents).values(row)
  return row
}

export async function listStreamProtocolEvents(args: {
  stream?: string
  afterSequence?: number
  limit?: number
} = {}): Promise<StreamProtocolEventRow[]> {
  const filters = [
    args.stream ? eq(schema.streamProtocolEvents.stream, args.stream) : undefined,
    args.afterSequence !== undefined
      ? gt(schema.streamProtocolEvents.sequence, args.afterSequence)
      : undefined,
  ].filter(Boolean)
  return db.query.streamProtocolEvents.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [asc(schema.streamProtocolEvents.stream), asc(schema.streamProtocolEvents.sequence)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export async function recordStreamReplayCursor(
  args: RecordStreamReplayCursorArgs,
): Promise<StreamReplayCursorRow> {
  const channel = await resolveStreamChannel(args.stream)
  const existing = await db.query.streamReplayCursors.findFirst({
    where: and(
      eq(schema.streamReplayCursors.stream, channel.stream),
      eq(schema.streamReplayCursors.clientId, args.clientId),
    ),
  })
  const now = Date.now()
  if (existing) {
    await db
      .update(schema.streamReplayCursors)
      .set({
        lastSequence: args.lastSequence ?? existing.lastSequence,
        transport: args.transport ?? existing.transport,
        disconnectedAt: args.disconnectedAt ?? existing.disconnectedAt,
        updatedAt: now,
      })
      .where(eq(schema.streamReplayCursors.id, existing.id))
    const updated = await db.query.streamReplayCursors.findFirst({
      where: eq(schema.streamReplayCursors.id, existing.id),
    })
    if (!updated) throw new Error('Stream replay cursor update failed.')
    return updated
  }
  const row: StreamReplayCursorRow = {
    id: newStreamReplayCursorId(),
    channelId: channel.id,
    stream: channel.stream,
    clientId: args.clientId.trim(),
    lastSequence: args.lastSequence ?? 0,
    transport: args.transport ?? 'sse',
    disconnectedAt: args.disconnectedAt ?? null,
    replayedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.streamReplayCursors).values(row)
  return row
}

export async function replayStreamEvents(args: RecordStreamReplayCursorArgs): Promise<StreamReplayResult> {
  const cursor = await recordStreamReplayCursor(args)
  const events = await listStreamProtocolEvents({
    stream: cursor.stream,
    afterSequence: cursor.lastSequence,
    limit: 200,
  })
  await db
    .update(schema.streamReplayCursors)
    .set({
      replayedAt: Date.now(),
      lastSequence: events.at(-1)?.sequence ?? cursor.lastSequence,
      updatedAt: Date.now(),
    })
    .where(eq(schema.streamReplayCursors.id, cursor.id))
  const updated = await db.query.streamReplayCursors.findFirst({
    where: eq(schema.streamReplayCursors.id, cursor.id),
  })
  return { cursor: updated ?? cursor, events }
}

export async function seedStreamProtocolChannels(): Promise<StreamProtocolChannelRow[]> {
  for (const channel of defaultChannels) {
    const existing = await db.query.streamProtocolChannels.findFirst({
      where: eq(schema.streamProtocolChannels.stream, channel.stream),
    })
    if (!existing) await createStreamProtocolChannel(channel)
  }
  return listStreamProtocolChannels({ limit: 50 })
}

async function resolveStreamChannel(stream: string): Promise<StreamProtocolChannelRow> {
  const channel = await db.query.streamProtocolChannels.findFirst({
    where: eq(schema.streamProtocolChannels.stream, stream.trim()),
  })
  if (channel) return channel
  return createStreamProtocolChannel({
    stream,
    description: 'Runtime stream registered on first publish.',
  })
}

function channelSnapshot(row: StreamProtocolChannelRow): JsonObject {
  return {
    stream: row.stream,
    primaryTransport: row.primaryTransport,
    fallbackTransport: row.fallbackTransport,
    replayRetentionMs: row.replayRetentionMs,
  }
}
