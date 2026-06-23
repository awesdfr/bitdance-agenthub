import { and, asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  OpenSourceGovernanceStatus,
  RiskLevel,
  ToolProtocolInvocationRow,
  ToolProtocolInvocationStatus,
  ToolProtocolManifestRow,
  ToolProtocolResultRow,
  ToolProtocolSource,
} from '@/db/schema'
import {
  newToolProtocolInvocationId,
  newToolProtocolManifestId,
  newToolProtocolResultId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface ToolProtocolAttributes {
  idempotent: boolean
  readOnly: boolean
  destructive: boolean
  longRunning: boolean
  requiresApproval: boolean
  riskLevel: RiskLevel
}

export interface CreateToolProtocolManifestArgs {
  name: string
  description?: string
  source: ToolProtocolSource
  inputSchema?: JsonObject
  attributes: ToolProtocolAttributes
  status?: OpenSourceGovernanceStatus
}

export interface CreateToolProtocolInvocationArgs {
  manifestId: string
  callId?: string
  toolName: string
  arguments: JsonObject
  idempotencyKey?: string | null
  status?: ToolProtocolInvocationStatus
}

export interface CreateToolProtocolResultArgs {
  invocationId: string
  callId: string
  success: boolean
  data?: JsonObject | null
  error?: JsonObject | null
  metadata?: JsonObject
}

export interface ToolProtocolSeed {
  manifests: ToolProtocolManifestRow[]
}

const defaultManifests: CreateToolProtocolManifestArgs[] = [
  {
    name: 'filesystem.read',
    description: 'Read a workspace file through the standard ToolManifest protocol.',
    source: 'internal',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
      },
    },
    attributes: {
      idempotent: true,
      readOnly: true,
      destructive: false,
      longRunning: false,
      requiresApproval: false,
      riskLevel: 'low',
    },
  },
  {
    name: 'shell.run',
    description: 'Run a shell command through a guarded CLI adapter.',
    source: 'cli',
    inputSchema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
      },
    },
    attributes: {
      idempotent: false,
      readOnly: false,
      destructive: false,
      longRunning: true,
      requiresApproval: true,
      riskLevel: 'high',
    },
  },
  {
    name: 'mcp.github.search',
    description: 'Search GitHub through an MCP tool using idempotent read-only semantics.',
    source: 'mcp',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
      },
    },
    attributes: {
      idempotent: true,
      readOnly: true,
      destructive: false,
      longRunning: false,
      requiresApproval: false,
      riskLevel: 'low',
    },
  },
]

export async function createToolProtocolManifest(
  args: CreateToolProtocolManifestArgs,
): Promise<ToolProtocolManifestRow> {
  const now = Date.now()
  const row: ToolProtocolManifestRow = {
    id: newToolProtocolManifestId(),
    name: args.name.trim(),
    description: args.description?.trim() ?? '',
    source: args.source,
    inputSchema: args.inputSchema ?? {},
    idempotent: args.attributes.idempotent,
    readOnly: args.attributes.readOnly,
    destructive: args.attributes.destructive,
    longRunning: args.attributes.longRunning,
    requiresApproval: args.attributes.requiresApproval,
    riskLevel: args.attributes.riskLevel,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.toolProtocolManifests).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'tool_protocol.manifest.create',
    resourceType: 'tool_protocol_manifest',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: row.riskLevel,
    message: `${row.name} ToolManifest registered.`,
    metadata: manifestSnapshot(row),
  })
  return row
}

export async function listToolProtocolManifests(args: {
  source?: ToolProtocolSource
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<ToolProtocolManifestRow[]> {
  const filters = [
    args.source ? eq(schema.toolProtocolManifests.source, args.source) : undefined,
    args.status ? eq(schema.toolProtocolManifests.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.toolProtocolManifests.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [asc(schema.toolProtocolManifests.name)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export async function createToolProtocolInvocation(
  args: CreateToolProtocolInvocationArgs,
): Promise<ToolProtocolInvocationRow> {
  const manifest = await db.query.toolProtocolManifests.findFirst({
    where: eq(schema.toolProtocolManifests.id, args.manifestId),
  })
  if (!manifest) throw new Error(`ToolManifest ${args.manifestId} was not found.`)
  if (manifest.name !== args.toolName) {
    throw new Error(`ToolInvocation toolName ${args.toolName} does not match manifest ${manifest.name}.`)
  }
  const now = Date.now()
  const id = newToolProtocolInvocationId()
  const row: ToolProtocolInvocationRow = {
    id,
    manifestId: manifest.id,
    callId: args.callId?.trim() || id,
    toolName: args.toolName.trim(),
    argumentsJson: args.arguments,
    idempotencyKey: args.idempotencyKey?.trim() || null,
    status: args.status ?? 'created',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.toolProtocolInvocations).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'tool_protocol.invocation.create',
    resourceType: 'tool_protocol_invocation',
    resourceId: row.id,
    status: manifest.requiresApproval ? 'warning' : 'allowed',
    riskLevel: manifest.riskLevel,
    message: `${row.callId} invoked ${row.toolName}.`,
    metadata: invocationSnapshot(row, manifest),
  })
  return row
}

export async function listToolProtocolInvocations(args: {
  manifestId?: string
  toolName?: string
  status?: ToolProtocolInvocationStatus
  limit?: number
} = {}): Promise<ToolProtocolInvocationRow[]> {
  const filters = [
    args.manifestId ? eq(schema.toolProtocolInvocations.manifestId, args.manifestId) : undefined,
    args.toolName ? eq(schema.toolProtocolInvocations.toolName, args.toolName) : undefined,
    args.status ? eq(schema.toolProtocolInvocations.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.toolProtocolInvocations.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.toolProtocolInvocations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export async function createToolProtocolResult(
  args: CreateToolProtocolResultArgs,
): Promise<ToolProtocolResultRow> {
  const invocation = await db.query.toolProtocolInvocations.findFirst({
    where: eq(schema.toolProtocolInvocations.id, args.invocationId),
  })
  if (!invocation) throw new Error(`ToolInvocation ${args.invocationId} was not found.`)
  if (invocation.callId !== args.callId) {
    throw new Error(`ToolResult callId ${args.callId} does not match invocation ${invocation.callId}.`)
  }
  const row: ToolProtocolResultRow = {
    id: newToolProtocolResultId(),
    invocationId: invocation.id,
    callId: args.callId,
    success: args.success,
    data: args.data ?? null,
    error: args.error ?? null,
    metadata: args.metadata ?? {},
    createdAt: Date.now(),
  }
  await db.insert(schema.toolProtocolResults).values(row)
  await db
    .update(schema.toolProtocolInvocations)
    .set({ status: row.success ? 'succeeded' : 'failed', updatedAt: Date.now() })
    .where(eq(schema.toolProtocolInvocations.id, invocation.id))
  await recordAuditLog({
    actorType: 'system',
    action: 'tool_protocol.result.create',
    resourceType: 'tool_protocol_result',
    resourceId: row.id,
    status: row.success ? 'allowed' : 'warning',
    riskLevel: 'low',
    message: `${row.callId} ToolResult recorded.`,
    metadata: resultSnapshot(row),
  })
  return row
}

export async function listToolProtocolResults(args: {
  invocationId?: string
  callId?: string
  limit?: number
} = {}): Promise<ToolProtocolResultRow[]> {
  const filters = [
    args.invocationId ? eq(schema.toolProtocolResults.invocationId, args.invocationId) : undefined,
    args.callId ? eq(schema.toolProtocolResults.callId, args.callId) : undefined,
  ].filter(Boolean)
  return db.query.toolProtocolResults.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.toolProtocolResults.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export async function seedToolInvocationProtocol(): Promise<ToolProtocolSeed> {
  for (const manifest of defaultManifests) {
    const existing = await db.query.toolProtocolManifests.findFirst({
      where: eq(schema.toolProtocolManifests.name, manifest.name),
    })
    if (!existing) await createToolProtocolManifest(manifest)
  }
  return {
    manifests: await listToolProtocolManifests({ limit: 100 }),
  }
}

function manifestSnapshot(row: ToolProtocolManifestRow): JsonObject {
  return {
    name: row.name,
    source: row.source,
    idempotent: row.idempotent,
    readOnly: row.readOnly,
    destructive: row.destructive,
    longRunning: row.longRunning,
    requiresApproval: row.requiresApproval,
    riskLevel: row.riskLevel,
  }
}

function invocationSnapshot(
  row: ToolProtocolInvocationRow,
  manifest: ToolProtocolManifestRow,
): JsonObject {
  return {
    callId: row.callId,
    toolName: row.toolName,
    idempotencyKey: row.idempotencyKey,
    manifest: manifestSnapshot(manifest),
  }
}

function resultSnapshot(row: ToolProtocolResultRow): JsonObject {
  return {
    callId: row.callId,
    success: row.success,
    hasData: row.data !== null,
    hasError: row.error !== null,
  }
}
