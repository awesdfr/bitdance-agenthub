import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ArchitectureInterfaceRow,
  ArchitecturePatternKey,
  ArchitecturePatternRow,
  JsonObject,
  OpenSourceGovernanceStatus,
} from '@/db/schema'
import {
  newArchitectureInterfaceId,
  newArchitecturePatternId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateArchitecturePatternArgs {
  patternKey: ArchitecturePatternKey
  name: string
  description?: string
  appliedTo?: string[]
  required?: boolean
  status?: OpenSourceGovernanceStatus
}

export interface CreateArchitectureInterfaceArgs {
  interfaceName: string
  responsibility?: string
  reservedMethods?: string[]
  ownerService?: string
  status?: OpenSourceGovernanceStatus
}

export interface ArchitecturePatternSeed {
  patterns: ArchitecturePatternRow[]
  interfaces: ArchitectureInterfaceRow[]
}

const defaultPatterns: CreateArchitecturePatternArgs[] = [
  {
    patternKey: 'event_bus',
    name: 'EventBus',
    description: 'Event-driven integration for runtime and UI state propagation.',
    appliedTo: ['run_event_feed', 'notifications', 'workflow_events'],
  },
  {
    patternKey: 'command',
    name: 'Command',
    description: 'Operations are represented as replayable/undoable command records.',
    appliedTo: ['config_versions', 'computer_actions', 'macro_replay_runs'],
  },
  {
    patternKey: 'strategy',
    name: 'Strategy',
    description: 'Model, recovery, compression, and routing policies stay pluggable.',
    appliedTo: ['model_gateway', 'recovery_service', 'prompt_context'],
  },
  {
    patternKey: 'observer',
    name: 'Observer',
    description: 'Realtime push surfaces observe state changes without owning them.',
    appliedTo: ['sse_feeds', 'monitoring', 'governance_center'],
  },
  {
    patternKey: 'responsibility_chain',
    name: 'Responsibility Chain',
    description: 'Input and output purification passes through ordered guardrails.',
    appliedTo: ['security_findings', 'artifact_validation', 'output_contracts'],
  },
  {
    patternKey: 'repository',
    name: 'Repository',
    description: 'Data access remains abstracted behind services instead of UI SQL.',
    appliedTo: ['control_plane_services', 'memory_service', 'workflow_service'],
  },
  {
    patternKey: 'factory',
    name: 'Factory',
    description: 'Agent and workstation creation flows are explicit factory operations.',
    appliedTo: ['agent_profiles', 'agent_workstations', 'computer_sessions'],
  },
  {
    patternKey: 'state',
    name: 'State',
    description: 'Every major entity records lifecycle state transitions.',
    appliedTo: ['employee_runs', 'workflow_runs', 'approvals', 'resource_locks'],
  },
]

const defaultInterfaces: CreateArchitectureInterfaceArgs[] = [
  {
    interfaceName: 'IEventBus',
    responsibility: 'Publish, subscribe, replay, and serialize domain events.',
    reservedMethods: ['publish(event)', 'subscribe(topic, handler)', 'replay(streamId)', 'toSse(event)'],
    ownerService: 'run-event-feed-service',
  },
  {
    interfaceName: 'IStorage',
    responsibility: 'Abstract persistence, snapshots, and transactional reads/writes.',
    reservedMethods: ['get(key)', 'put(key, value)', 'transaction(work)', 'snapshot(scope)'],
    ownerService: 'db/client',
  },
  {
    interfaceName: 'ILockService',
    responsibility: 'Acquire, renew, release, and expire resource locks.',
    reservedMethods: ['acquire(resource)', 'renew(lockId)', 'release(lockId)', 'expireStale(now)'],
    ownerService: 'resource-lock-service',
  },
  {
    interfaceName: 'IModelProvider',
    responsibility: 'Normalize model calls, tool support, vision support, and fallback behavior.',
    reservedMethods: ['complete(request)', 'stream(request)', 'testConnection(profile)', 'estimateCost(request)'],
    ownerService: 'model-gateway-service',
  },
  {
    interfaceName: 'IComputerSession',
    responsibility: 'Represent isolated browser/desktop/mobile workstations and observation timelines.',
    reservedMethods: ['createSession(run)', 'observe(sessionId)', 'perform(action)', 'close(sessionId)'],
    ownerService: 'computer-session-manager',
  },
]

export async function createArchitecturePattern(
  args: CreateArchitecturePatternArgs,
): Promise<ArchitecturePatternRow> {
  const now = Date.now()
  const row: ArchitecturePatternRow = {
    id: newArchitecturePatternId(),
    patternKey: args.patternKey,
    name: args.name.trim(),
    description: args.description?.trim() ?? '',
    appliedTo: args.appliedTo?.map((item) => item.trim()).filter(Boolean) ?? [],
    required: args.required ?? true,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.architecturePatterns).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'architecture.pattern.create',
    resourceType: 'architecture_pattern',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `${row.name} pattern registered.`,
    metadata: patternSnapshot(row),
  })
  return row
}

export async function listArchitecturePatterns(args: {
  patternKey?: ArchitecturePatternKey
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<ArchitecturePatternRow[]> {
  const filters = [
    args.patternKey ? eq(schema.architecturePatterns.patternKey, args.patternKey) : undefined,
    args.status ? eq(schema.architecturePatterns.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.architecturePatterns.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.architecturePatterns.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function createArchitectureInterface(
  args: CreateArchitectureInterfaceArgs,
): Promise<ArchitectureInterfaceRow> {
  const now = Date.now()
  const row: ArchitectureInterfaceRow = {
    id: newArchitectureInterfaceId(),
    interfaceName: args.interfaceName.trim(),
    responsibility: args.responsibility?.trim() ?? '',
    reservedMethods: args.reservedMethods?.map((item) => item.trim()).filter(Boolean) ?? [],
    ownerService: args.ownerService?.trim() ?? '',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.architectureInterfaces).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'architecture.interface.create',
    resourceType: 'architecture_interface',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `${row.interfaceName} interface reserved.`,
    metadata: interfaceSnapshot(row),
  })
  return row
}

export async function listArchitectureInterfaces(args: {
  interfaceName?: string
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<ArchitectureInterfaceRow[]> {
  const filters = [
    args.interfaceName ? eq(schema.architectureInterfaces.interfaceName, args.interfaceName) : undefined,
    args.status ? eq(schema.architectureInterfaces.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.architectureInterfaces.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.architectureInterfaces.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function seedArchitecturePatterns(): Promise<ArchitecturePatternSeed> {
  for (const pattern of defaultPatterns) {
    const existing = await db.query.architecturePatterns.findFirst({
      where: eq(schema.architecturePatterns.patternKey, pattern.patternKey),
    })
    if (!existing) await createArchitecturePattern(pattern)
  }
  for (const item of defaultInterfaces) {
    const existing = await db.query.architectureInterfaces.findFirst({
      where: eq(schema.architectureInterfaces.interfaceName, item.interfaceName),
    })
    if (!existing) await createArchitectureInterface(item)
  }
  return {
    patterns: await listArchitecturePatterns({ limit: 100 }),
    interfaces: await listArchitectureInterfaces({ limit: 100 }),
  }
}

function patternSnapshot(row: ArchitecturePatternRow): JsonObject {
  return {
    patternKey: row.patternKey,
    appliedTo: row.appliedTo,
    required: row.required,
  }
}

function interfaceSnapshot(row: ArchitectureInterfaceRow): JsonObject {
  return {
    interfaceName: row.interfaceName,
    reservedMethods: row.reservedMethods,
    ownerService: row.ownerService,
  }
}
