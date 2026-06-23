import { and, asc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  EntityStateMachineRow,
  EntityStateMachineType,
  EntityStateTransitionRow,
  JsonObject,
  OpenSourceGovernanceStatus,
} from '@/db/schema'
import {
  newEntityStateMachineId,
  newEntityStateTransitionId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateEntityStateMachineArgs {
  entityType: EntityStateMachineType
  name: string
  description?: string
  states: string[]
  initialState: string
  terminalStates?: string[]
  errorState?: string | null
  status?: OpenSourceGovernanceStatus
}

export interface CreateEntityStateTransitionArgs {
  machineId: string
  entityType: EntityStateMachineType
  fromState: string
  toState: string
  trigger?: string
  reversible?: boolean
  description?: string
  status?: OpenSourceGovernanceStatus
}

export interface EntityStateMachineSeed {
  machines: EntityStateMachineRow[]
  transitions: EntityStateTransitionRow[]
}

export interface EntityStateTransitionEvaluation {
  allowed: boolean
  reason: string
  machine: EntityStateMachineRow | null
  transition: EntityStateTransitionRow | null
}

type TransitionDefinition = Omit<CreateEntityStateTransitionArgs, 'machineId'>
type MachineDefinition = CreateEntityStateMachineArgs & {
  transitions: TransitionDefinition[]
}

const defaultStateMachines: MachineDefinition[] = [
  {
    entityType: 'agent',
    name: 'Agent lifecycle',
    description: 'Agent profile lifecycle from draft to deleted, with any-state error capture.',
    states: ['draft', 'testing', 'active', 'paused', 'archived', 'deleted', 'error'],
    initialState: 'draft',
    terminalStates: ['deleted', 'error'],
    errorState: 'error',
    transitions: [
      transition('agent', 'draft', 'testing', 'submit_test'),
      transition('agent', 'testing', 'active', 'activate'),
      transition('agent', 'active', 'paused', 'pause'),
      transition('agent', 'paused', 'archived', 'archive'),
      transition('agent', 'archived', 'deleted', 'delete'),
      ...anyToError('agent', ['draft', 'testing', 'active', 'paused', 'archived', 'deleted']),
    ],
  },
  {
    entityType: 'task_run',
    name: 'Task/Run lifecycle',
    description: 'Run lifecycle from pending to terminal completion, retry, pause, and cancellation.',
    states: ['pending', 'queued', 'running', 'completing', 'completed', 'failed', 'paused', 'cancelled'],
    initialState: 'pending',
    terminalStates: ['completed', 'cancelled'],
    errorState: 'failed',
    transitions: [
      transition('task_run', 'pending', 'queued', 'enqueue'),
      transition('task_run', 'queued', 'running', 'start'),
      transition('task_run', 'running', 'completing', 'complete_work'),
      transition('task_run', 'completing', 'completed', 'verify_success'),
      transition('task_run', 'completing', 'failed', 'verify_failure'),
      transition('task_run', 'running', 'paused', 'pause'),
      transition('task_run', 'paused', 'running', 'resume', true),
      transition('task_run', 'running', 'cancelled', 'cancel'),
      transition('task_run', 'queued', 'cancelled', 'cancel'),
      transition('task_run', 'failed', 'queued', 'retry'),
    ],
  },
  {
    entityType: 'workflow',
    name: 'Workflow lifecycle',
    description: 'Workflow publishing lifecycle from draft to archived retirement.',
    states: ['draft', 'published', 'deprecated', 'retired', 'archived'],
    initialState: 'draft',
    terminalStates: ['archived'],
    transitions: [
      transition('workflow', 'draft', 'published', 'publish'),
      transition('workflow', 'published', 'deprecated', 'deprecate'),
      transition('workflow', 'deprecated', 'retired', 'retire'),
      transition('workflow', 'retired', 'archived', 'archive'),
    ],
  },
  {
    entityType: 'memory',
    name: 'Memory lifecycle',
    description: 'Memory lifecycle with decay, expiry, deletion, and pinned non-expiring state.',
    states: ['active', 'decaying', 'expired', 'deleted', 'pinned'],
    initialState: 'active',
    terminalStates: ['deleted', 'pinned'],
    transitions: [
      transition('memory', 'active', 'decaying', 'decay'),
      transition('memory', 'decaying', 'expired', 'expire'),
      transition('memory', 'expired', 'deleted', 'delete'),
      transition('memory', 'active', 'pinned', 'pin'),
    ],
  },
  {
    entityType: 'skill',
    name: 'Skill lifecycle',
    description: 'Skill installation and enablement lifecycle including uninstall removal.',
    states: ['available', 'installing', 'installed', 'enabled', 'disabled', 'uninstalling', 'removed'],
    initialState: 'available',
    terminalStates: ['removed'],
    transitions: [
      transition('skill', 'available', 'installing', 'install'),
      transition('skill', 'installing', 'installed', 'install_complete'),
      transition('skill', 'installed', 'enabled', 'enable'),
      transition('skill', 'installed', 'disabled', 'disable'),
      transition('skill', 'enabled', 'disabled', 'disable', true),
      transition('skill', 'disabled', 'enabled', 'enable', true),
      transition('skill', 'enabled', 'uninstalling', 'uninstall'),
      transition('skill', 'disabled', 'uninstalling', 'uninstall'),
      transition('skill', 'uninstalling', 'removed', 'remove'),
    ],
  },
]

export async function createEntityStateMachine(
  args: CreateEntityStateMachineArgs,
): Promise<EntityStateMachineRow> {
  const states = normalizeStates(args.states)
  ensureState(states, args.initialState, 'initial')
  for (const terminal of args.terminalStates ?? []) ensureState(states, terminal, 'terminal')
  if (args.errorState) ensureState(states, args.errorState, 'error')

  const now = Date.now()
  const row: EntityStateMachineRow = {
    id: newEntityStateMachineId(),
    entityType: args.entityType,
    name: args.name.trim(),
    description: args.description?.trim() ?? '',
    states,
    initialState: args.initialState.trim(),
    terminalStates: (args.terminalStates ?? []).map((state) => state.trim()),
    errorState: args.errorState?.trim() || null,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.entityStateMachines).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'entity_state_machine.create',
    resourceType: 'entity_state_machine',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `${row.name} state machine registered.`,
    metadata: machineSnapshot(row),
  })
  return row
}

export async function createEntityStateTransition(
  args: CreateEntityStateTransitionArgs,
): Promise<EntityStateTransitionRow> {
  const machine = await db.query.entityStateMachines.findFirst({
    where: eq(schema.entityStateMachines.id, args.machineId),
  })
  if (!machine) throw new Error(`State machine ${args.machineId} was not found.`)
  if (machine.entityType !== args.entityType) {
    throw new Error(`Transition entity type ${args.entityType} does not match ${machine.entityType}.`)
  }
  ensureState(machine.states, args.fromState, 'from')
  ensureState(machine.states, args.toState, 'to')

  const now = Date.now()
  const row: EntityStateTransitionRow = {
    id: newEntityStateTransitionId(),
    machineId: args.machineId,
    entityType: args.entityType,
    fromState: args.fromState.trim(),
    toState: args.toState.trim(),
    trigger: args.trigger?.trim() ?? '',
    reversible: args.reversible ?? false,
    description: args.description?.trim() ?? '',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.entityStateTransitions).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'entity_state_transition.create',
    resourceType: 'entity_state_transition',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `${row.entityType} ${row.fromState} -> ${row.toState} registered.`,
    metadata: transitionSnapshot(row),
  })
  return row
}

export async function listEntityStateMachines(args: {
  entityType?: EntityStateMachineType
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<EntityStateMachineRow[]> {
  const filters = [
    args.entityType ? eq(schema.entityStateMachines.entityType, args.entityType) : undefined,
    args.status ? eq(schema.entityStateMachines.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.entityStateMachines.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [asc(schema.entityStateMachines.entityType)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function listEntityStateTransitions(args: {
  machineId?: string
  entityType?: EntityStateMachineType
  fromState?: string
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<EntityStateTransitionRow[]> {
  const filters = [
    args.machineId ? eq(schema.entityStateTransitions.machineId, args.machineId) : undefined,
    args.entityType ? eq(schema.entityStateTransitions.entityType, args.entityType) : undefined,
    args.fromState ? eq(schema.entityStateTransitions.fromState, args.fromState.trim()) : undefined,
    args.status ? eq(schema.entityStateTransitions.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.entityStateTransitions.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [
      asc(schema.entityStateTransitions.entityType),
      asc(schema.entityStateTransitions.fromState),
      asc(schema.entityStateTransitions.toState),
    ],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export async function evaluateEntityStateTransition(args: {
  entityType: EntityStateMachineType
  fromState: string
  toState: string
}): Promise<EntityStateTransitionEvaluation> {
  const machine = await db.query.entityStateMachines.findFirst({
    where: and(
      eq(schema.entityStateMachines.entityType, args.entityType),
      eq(schema.entityStateMachines.status, 'active'),
    ),
  })
  if (!machine) {
    return {
      allowed: false,
      reason: `No active state machine for ${args.entityType}.`,
      machine: null,
      transition: null,
    }
  }
  if (!machine.states.includes(args.fromState) || !machine.states.includes(args.toState)) {
    return {
      allowed: false,
      reason: 'From or to state is not defined by the state machine.',
      machine,
      transition: null,
    }
  }
  const transitionRow = await db.query.entityStateTransitions.findFirst({
    where: and(
      eq(schema.entityStateTransitions.entityType, args.entityType),
      eq(schema.entityStateTransitions.fromState, args.fromState),
      eq(schema.entityStateTransitions.toState, args.toState),
      eq(schema.entityStateTransitions.status, 'active'),
    ),
  })
  if (!transitionRow) {
    return {
      allowed: false,
      reason: `${args.entityType} cannot transition ${args.fromState} -> ${args.toState}.`,
      machine,
      transition: null,
    }
  }
  return {
    allowed: true,
    reason: `${args.entityType} transition ${args.fromState} -> ${args.toState} is allowed.`,
    machine,
    transition: transitionRow,
  }
}

export async function seedEntityStateMachines(): Promise<EntityStateMachineSeed> {
  for (const definition of defaultStateMachines) {
    let machine = await db.query.entityStateMachines.findFirst({
      where: eq(schema.entityStateMachines.entityType, definition.entityType),
    })
    if (!machine) machine = await createEntityStateMachine(definition)

    for (const item of definition.transitions) {
      const existing = await db.query.entityStateTransitions.findFirst({
        where: and(
          eq(schema.entityStateTransitions.entityType, item.entityType),
          eq(schema.entityStateTransitions.fromState, item.fromState),
          eq(schema.entityStateTransitions.toState, item.toState),
          eq(schema.entityStateTransitions.trigger, item.trigger ?? ''),
        ),
      })
      if (!existing) await createEntityStateTransition({ ...item, machineId: machine.id })
    }
  }
  return {
    machines: await listEntityStateMachines({ limit: 50 }),
    transitions: await listEntityStateTransitions({ limit: 200 }),
  }
}

export function getDefaultStateMachineCounts(): { machines: number; transitions: number } {
  return {
    machines: defaultStateMachines.length,
    transitions: defaultStateMachines.reduce((sum, machine) => sum + machine.transitions.length, 0),
  }
}

function transition(
  entityType: EntityStateMachineType,
  fromState: string,
  toState: string,
  trigger: string,
  reversible = false,
): TransitionDefinition {
  return {
    entityType,
    fromState,
    toState,
    trigger,
    reversible,
    description: `${entityType} moves from ${fromState} to ${toState} via ${trigger}.`,
  }
}

function anyToError(entityType: EntityStateMachineType, fromStates: string[]): TransitionDefinition[] {
  return fromStates.map((fromState) =>
    transition(entityType, fromState, 'error', 'error_detected'),
  )
}

function normalizeStates(states: string[]): string[] {
  return [...new Set(states.map((state) => state.trim()).filter(Boolean))]
}

function ensureState(states: string[], state: string, label: string) {
  if (!states.includes(state.trim())) {
    throw new Error(`${label} state ${state} is not part of the state machine.`)
  }
}

function machineSnapshot(row: EntityStateMachineRow): JsonObject {
  return {
    entityType: row.entityType,
    states: row.states,
    initialState: row.initialState,
    terminalStates: row.terminalStates,
    errorState: row.errorState,
  }
}

function transitionSnapshot(row: EntityStateTransitionRow): JsonObject {
  return {
    entityType: row.entityType,
    fromState: row.fromState,
    toState: row.toState,
    trigger: row.trigger,
    reversible: row.reversible,
  }
}
