import { and, asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentCommunicationProtocolRow,
  AgentProtocolMessageRow,
  AgentProtocolMessageType,
  AgentProtocolPriority,
  AgentProtocolStatus,
  JsonObject,
} from '@/db/schema'
import {
  newAgentCommunicationProtocolId,
  newAgentProtocolMessageId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface AgentProtocolHeader {
  from: string
  to: string | null
  type: AgentProtocolMessageType
  priority: AgentProtocolPriority
  replyTo: string | null
}

export interface AgentProtocolBody {
  intent: string
  detail: string
  context: {
    artifacts: string[]
    memories: string[]
    files: string[]
  }
  proposedAction: JsonObject | null
}

export interface AgentProtocolEnvelope {
  version: string
  messageId: string
  timestamp: number
  ttl: number
  header: AgentProtocolHeader
  body: AgentProtocolBody
  signature?: string
}

export interface CreateAgentCommunicationProtocolArgs {
  version?: string
  name: string
  description?: string
  requiredTopLevelFields?: string[]
  headerFields?: string[]
  bodyFields?: string[]
  contextFields?: string[]
  supportsSignature?: boolean
  defaultTtlMs?: number
  status?: AgentProtocolStatus
}

export interface CreateAgentProtocolMessageArgs {
  protocolId?: string
  version?: string
  messageId?: string
  timestamp?: number
  ttl?: number
  header: AgentProtocolHeader
  body: AgentProtocolBody
  signature?: string | null
}

export interface AgentProtocolValidation {
  valid: boolean
  errors: string[]
  envelope: AgentProtocolEnvelope | null
}

const defaultProtocol: Required<CreateAgentCommunicationProtocolArgs> = {
  version: '1.0',
  name: 'Agent JSON Message Protocol',
  description:
    'Standard Agent-to-Agent JSON envelope with version/messageId/timestamp/ttl, header, body, context, proposedAction, and optional signature.',
  requiredTopLevelFields: ['version', 'messageId', 'timestamp', 'ttl', 'header', 'body'],
  headerFields: ['from', 'to', 'type', 'priority', 'replyTo'],
  bodyFields: ['intent', 'detail', 'context', 'proposedAction'],
  contextFields: ['artifacts', 'memories', 'files'],
  supportsSignature: true,
  defaultTtlMs: 3600000,
  status: 'active',
}

export async function createAgentCommunicationProtocol(
  args: CreateAgentCommunicationProtocolArgs,
): Promise<AgentCommunicationProtocolRow> {
  const now = Date.now()
  const row: AgentCommunicationProtocolRow = {
    id: newAgentCommunicationProtocolId(),
    version: args.version?.trim() || defaultProtocol.version,
    name: args.name.trim(),
    description: args.description?.trim() ?? '',
    requiredTopLevelFields: args.requiredTopLevelFields ?? defaultProtocol.requiredTopLevelFields,
    headerFields: args.headerFields ?? defaultProtocol.headerFields,
    bodyFields: args.bodyFields ?? defaultProtocol.bodyFields,
    contextFields: args.contextFields ?? defaultProtocol.contextFields,
    supportsSignature: args.supportsSignature ?? true,
    defaultTtlMs: args.defaultTtlMs ?? defaultProtocol.defaultTtlMs,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.agentCommunicationProtocols).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'agent_communication.protocol.create',
    resourceType: 'agent_communication_protocol',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `${row.name} v${row.version} registered.`,
    metadata: protocolSnapshot(row),
  })
  return row
}

export async function listAgentCommunicationProtocols(args: {
  version?: string
  status?: AgentProtocolStatus
  limit?: number
} = {}): Promise<AgentCommunicationProtocolRow[]> {
  const filters = [
    args.version ? eq(schema.agentCommunicationProtocols.version, args.version) : undefined,
    args.status ? eq(schema.agentCommunicationProtocols.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.agentCommunicationProtocols.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.agentCommunicationProtocols.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 20, 1), 100),
  })
}

export async function seedAgentCommunicationProtocol(): Promise<AgentCommunicationProtocolRow[]> {
  const existing = await db.query.agentCommunicationProtocols.findFirst({
    where: and(
      eq(schema.agentCommunicationProtocols.version, defaultProtocol.version),
      eq(schema.agentCommunicationProtocols.status, 'active'),
    ),
  })
  if (!existing) await createAgentCommunicationProtocol(defaultProtocol)
  return listAgentCommunicationProtocols({ limit: 50 })
}

export async function createAgentProtocolMessage(
  args: CreateAgentProtocolMessageArgs,
): Promise<AgentProtocolMessageRow> {
  const protocol = await resolveProtocol(args.protocolId, args.version)
  const id = newAgentProtocolMessageId()
  const timestamp = args.timestamp ?? Date.now()
  const ttl = args.ttl ?? protocol.defaultTtlMs
  const envelope: AgentProtocolEnvelope = {
    version: args.version?.trim() || protocol.version,
    messageId: args.messageId?.trim() || id,
    timestamp,
    ttl,
    header: {
      from: args.header.from.trim(),
      to: args.header.to?.trim() || null,
      type: args.header.type,
      priority: args.header.priority,
      replyTo: args.header.replyTo?.trim() || null,
    },
    body: {
      intent: args.body.intent.trim(),
      detail: args.body.detail.trim(),
      context: {
        artifacts: args.body.context.artifacts.map((item) => item.trim()).filter(Boolean),
        memories: args.body.context.memories.map((item) => item.trim()).filter(Boolean),
        files: args.body.context.files.map((item) => item.trim()).filter(Boolean),
      },
      proposedAction: args.body.proposedAction,
    },
  }
  if (args.signature?.trim()) envelope.signature = args.signature.trim()

  const validation = validateAgentProtocolEnvelope(envelope, protocol)
  const row: AgentProtocolMessageRow = {
    id,
    protocolId: protocol.id,
    version: envelope.version,
    messageId: envelope.messageId,
    timestamp: envelope.timestamp,
    ttlMs: envelope.ttl,
    expiresAt: envelope.timestamp + envelope.ttl,
    fromAgentId: envelope.header.from,
    toAgentId: envelope.header.to,
    messageType: envelope.header.type,
    priority: envelope.header.priority,
    replyTo: envelope.header.replyTo,
    intent: envelope.body.intent,
    detail: envelope.body.detail,
    context: envelope.body.context as unknown as JsonObject,
    proposedAction: envelope.body.proposedAction,
    signature: envelope.signature ?? null,
    validationStatus: validation.valid ? 'valid' : 'invalid',
    validationErrors: validation.errors,
    envelope: envelope as unknown as JsonObject,
    createdAt: Date.now(),
  }
  await db.insert(schema.agentProtocolMessages).values(row)
  await recordAuditLog({
    actorType: 'agent',
    actorId: row.fromAgentId,
    action: 'agent_communication.message.create',
    resourceType: 'agent_protocol_message',
    resourceId: row.id,
    status: validation.valid ? 'allowed' : 'warning',
    riskLevel: validation.valid ? 'low' : 'medium',
    message: `Protocol message ${row.messageId} created.`,
    metadata: messageSnapshot(row),
  })
  return row
}

export async function listAgentProtocolMessages(args: {
  fromAgentId?: string
  toAgentId?: string
  messageType?: AgentProtocolMessageType
  limit?: number
} = {}): Promise<AgentProtocolMessageRow[]> {
  const filters = [
    args.fromAgentId ? eq(schema.agentProtocolMessages.fromAgentId, args.fromAgentId) : undefined,
    args.toAgentId ? eq(schema.agentProtocolMessages.toAgentId, args.toAgentId) : undefined,
    args.messageType ? eq(schema.agentProtocolMessages.messageType, args.messageType) : undefined,
  ].filter(Boolean)
  return db.query.agentProtocolMessages.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [asc(schema.agentProtocolMessages.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export function validateAgentProtocolEnvelope(
  envelope: unknown,
  protocol: Pick<
    AgentCommunicationProtocolRow,
    'requiredTopLevelFields' | 'headerFields' | 'bodyFields' | 'contextFields' | 'supportsSignature'
  > = defaultProtocol,
): AgentProtocolValidation {
  const errors: string[] = []
  if (!isRecord(envelope)) {
    return { valid: false, errors: ['Envelope must be an object.'], envelope: null }
  }
  for (const field of protocol.requiredTopLevelFields) {
    if (!(field in envelope)) errors.push(`Missing top-level field ${field}.`)
  }
  const header = envelope.header
  const body = envelope.body
  if (!isRecord(header)) errors.push('Header must be an object.')
  if (!isRecord(body)) errors.push('Body must be an object.')
  if (isRecord(header)) {
    for (const field of protocol.headerFields) {
      if (!(field in header)) errors.push(`Missing header field ${field}.`)
    }
  }
  if (isRecord(body)) {
    for (const field of protocol.bodyFields) {
      if (!(field in body)) errors.push(`Missing body field ${field}.`)
    }
    if (!isRecord(body.context)) {
      errors.push('Body context must be an object.')
    } else {
      for (const field of protocol.contextFields) {
        if (!Array.isArray(body.context[field])) errors.push(`Context field ${field} must be an array.`)
      }
    }
  }
  if (typeof envelope.version !== 'string' || envelope.version.length === 0) {
    errors.push('version must be a non-empty string.')
  }
  if (typeof envelope.messageId !== 'string' || envelope.messageId.length === 0) {
    errors.push('messageId must be a non-empty string.')
  }
  if (typeof envelope.timestamp !== 'number' || envelope.timestamp <= 0) {
    errors.push('timestamp must be a positive number.')
  }
  if (typeof envelope.ttl !== 'number' || envelope.ttl <= 0) {
    errors.push('ttl must be a positive number.')
  }
  if ('signature' in envelope && !protocol.supportsSignature) {
    errors.push('signature is present but this protocol does not support signatures.')
  }
  return {
    valid: errors.length === 0,
    errors,
    envelope: errors.length === 0 ? (envelope as unknown as AgentProtocolEnvelope) : null,
  }
}

async function resolveProtocol(
  protocolId?: string,
  version = defaultProtocol.version,
): Promise<AgentCommunicationProtocolRow> {
  if (protocolId) {
    const protocol = await db.query.agentCommunicationProtocols.findFirst({
      where: eq(schema.agentCommunicationProtocols.id, protocolId),
    })
    if (!protocol) throw new Error(`Agent communication protocol ${protocolId} was not found.`)
    return protocol
  }
  let protocol = await db.query.agentCommunicationProtocols.findFirst({
    where: and(
      eq(schema.agentCommunicationProtocols.version, version),
      eq(schema.agentCommunicationProtocols.status, 'active'),
    ),
  })
  if (!protocol) {
    await seedAgentCommunicationProtocol()
    protocol = await db.query.agentCommunicationProtocols.findFirst({
      where: and(
        eq(schema.agentCommunicationProtocols.version, version),
        eq(schema.agentCommunicationProtocols.status, 'active'),
      ),
    })
  }
  if (!protocol) throw new Error(`No active Agent communication protocol v${version}.`)
  return protocol
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function protocolSnapshot(row: AgentCommunicationProtocolRow): JsonObject {
  return {
    version: row.version,
    requiredTopLevelFields: row.requiredTopLevelFields,
    headerFields: row.headerFields,
    bodyFields: row.bodyFields,
    contextFields: row.contextFields,
    supportsSignature: row.supportsSignature,
  }
}

function messageSnapshot(row: AgentProtocolMessageRow): JsonObject {
  return {
    version: row.version,
    messageId: row.messageId,
    fromAgentId: row.fromAgentId,
    toAgentId: row.toAgentId,
    type: row.messageType,
    priority: row.priority,
    validationStatus: row.validationStatus,
  }
}
