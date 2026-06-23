import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentInboxItemRow,
  AgentInboxItemStatus,
  AgentInboxItemType,
  JsonObject,
  RuntimeBusyAction,
  RuntimeMicroOperationDecisionRow,
  RuntimeMicroOperationDecisionStatus,
  RuntimeMicroOperationPolicy,
  RuntimeMicroOperationPolicyRow,
  RuntimeTimeoutAction,
  RuntimeTimeoutKind,
  ScheduledActionRow,
  ScheduledActionStatus,
} from '@/db/schema'
import {
  newAgentInboxItemId,
  newRuntimeMicroOperationDecisionId,
  newRuntimeMicroOperationPolicyId,
  newScheduledActionId,
} from '@/server/ids'

export interface CreateRuntimeMicroOperationPolicyArgs {
  name?: string
  status?: RuntimeMicroOperationPolicyRow['status']
  policy?: PartialRuntimeMicroOperationPolicy
}

export interface EvaluateRuntimeTimeoutArgs {
  policyId?: string
  agentProfileId?: string | null
  kind: RuntimeTimeoutKind
  elapsedMs: number
  noProgressSteps?: number
}

export interface EvaluateBusyTaskArgs {
  policyId?: string
  agentProfileId?: string | null
  currentTaskTitle?: string
  newTaskTitle: string
  currentPriority?: number
  newPriority?: number
  otherAgentCapable?: boolean
  otherAgentId?: string | null
}

export interface CreateScheduledActionArgs {
  agentProfileId?: string | null
  instruction: string
  dueAt: number
  payload?: JsonObject
}

export interface RunDueScheduledActionsArgs {
  now?: number
  busyAgentIds?: string[]
  limit?: number
}

export interface CreateInboxItemArgs {
  agentProfileId?: string | null
  itemType: AgentInboxItemType
  title: string
  body?: string
  priority?: number
  payload?: JsonObject
}

type PartialRuntimeMicroOperationPolicy = {
  idleTimeout?: {
    waitingForApproval?: Partial<RuntimeMicroOperationPolicy['idleTimeout']['waitingForApproval']>
    agentIdle?: Partial<RuntimeMicroOperationPolicy['idleTimeout']['agentIdle']>
    agentStuck?: Partial<RuntimeMicroOperationPolicy['idleTimeout']['agentStuck']>
  }
  busyBehavior?: Partial<RuntimeMicroOperationPolicy['busyBehavior']>
  delayedActions?: Partial<RuntimeMicroOperationPolicy['delayedActions']>
  inbox?: Partial<RuntimeMicroOperationPolicy['inbox']>
}

const DEFAULT_POLICY_NAME = 'Default runtime micro-operation policy'

const defaultPolicy: RuntimeMicroOperationPolicy = {
  idleTimeout: {
    waitingForApproval: {
      timeout: 30 * 60 * 1000,
      onTimeout: 'keep_waiting',
    },
    agentIdle: {
      timeout: 2 * 60 * 60 * 1000,
      onTimeout: 'hibernate',
    },
    agentStuck: {
      noProgressSteps: 3,
      timeout: 10 * 60 * 1000,
      onTimeout: 'replan',
    },
  },
  busyBehavior: {
    defaultAction: 'queue_after_current',
    highPriorityAction: 'safe_pause_and_preempt',
    delegateWhenOtherAgentCapable: true,
    askUserBeforeInterrupting: false,
    priorityPreemptDelta: 5,
  },
  delayedActions: {
    wakeHibernatingAgent: true,
    queueWhenBusy: true,
  },
  inbox: {
    processWhenIdle: true,
    priorityOrder: [
      'approval_result',
      'task_assignment',
      'user_message',
      'agent_help',
      'system_notification',
    ],
  },
}

export async function seedRuntimeMicroOperationPolicy(): Promise<RuntimeMicroOperationPolicyRow> {
  const existing = await db.query.runtimeMicroOperationPolicies.findFirst({
    where: eq(schema.runtimeMicroOperationPolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  const now = Date.now()
  const row: RuntimeMicroOperationPolicyRow = {
    id: newRuntimeMicroOperationPolicyId(),
    name: DEFAULT_POLICY_NAME,
    policy: defaultPolicy,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.runtimeMicroOperationPolicies).values(row)
  return row
}

export async function createRuntimeMicroOperationPolicy(
  args: CreateRuntimeMicroOperationPolicyArgs = {},
): Promise<RuntimeMicroOperationPolicyRow> {
  const now = Date.now()
  const row: RuntimeMicroOperationPolicyRow = {
    id: newRuntimeMicroOperationPolicyId(),
    name: args.name ?? `Runtime micro-operation ${new Date(now).toISOString()}`,
    policy: mergePolicy(args.policy),
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.runtimeMicroOperationPolicies).values(row)
  return row
}

export async function listRuntimeMicroOperationPolicies(args: {
  status?: RuntimeMicroOperationPolicyRow['status']
  limit?: number
} = {}): Promise<RuntimeMicroOperationPolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.runtimeMicroOperationPolicies.status, args.status))
  return db.query.runtimeMicroOperationPolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.runtimeMicroOperationPolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function evaluateRuntimeTimeout(
  args: EvaluateRuntimeTimeoutArgs,
): Promise<RuntimeMicroOperationDecisionRow> {
  const policy = args.policyId ? await getRequiredPolicy(args.policyId) : await seedRuntimeMicroOperationPolicy()
  if (policy.status !== 'active') throw new Error(`Runtime micro-operation policy is ${policy.status}: ${policy.id}`)
  const config = timeoutConfig(policy.policy, args.kind)
  const timedOut = args.elapsedMs >= config.timeout &&
    (args.kind !== 'agent_stuck' || (args.noProgressSteps ?? 0) >= (config.noProgressSteps ?? 0))
  const action = timedOut ? config.onTimeout : notTimedOutAction(args.kind)
  return recordDecision({
    policyId: policy.id,
    agentProfileId: args.agentProfileId ?? null,
    decisionType: 'idle_timeout',
    action,
    status: statusFromTimeoutAction(action, timedOut),
    input: {
      kind: args.kind,
      elapsedMs: args.elapsedMs,
      noProgressSteps: args.noProgressSteps ?? 0,
      timeout: config.timeout,
      requiredNoProgressSteps: config.noProgressSteps ?? null,
    },
    result: {
      timedOut,
      recommendation: recommendationForTimeout(args.kind, action, timedOut),
    },
  })
}

export async function evaluateBusyTask(
  args: EvaluateBusyTaskArgs,
): Promise<RuntimeMicroOperationDecisionRow> {
  const policy = args.policyId ? await getRequiredPolicy(args.policyId) : await seedRuntimeMicroOperationPolicy()
  if (policy.status !== 'active') throw new Error(`Runtime micro-operation policy is ${policy.status}: ${policy.id}`)
  const currentPriority = args.currentPriority ?? 0
  const newPriority = args.newPriority ?? 0
  const priorityDelta = newPriority - currentPriority
  let action: RuntimeBusyAction = policy.policy.busyBehavior.defaultAction
  if (priorityDelta >= policy.policy.busyBehavior.priorityPreemptDelta) {
    action = policy.policy.busyBehavior.askUserBeforeInterrupting
      ? 'ask_user'
      : policy.policy.busyBehavior.highPriorityAction
  } else if (args.otherAgentCapable && policy.policy.busyBehavior.delegateWhenOtherAgentCapable) {
    action = 'delegate_to_other_agent'
  }
  return recordDecision({
    policyId: policy.id,
    agentProfileId: args.agentProfileId ?? null,
    decisionType: 'busy_task',
    action,
    status: statusFromBusyAction(action),
    input: {
      currentTaskTitle: args.currentTaskTitle ?? '',
      newTaskTitle: args.newTaskTitle,
      currentPriority,
      newPriority,
      priorityDelta,
      otherAgentCapable: Boolean(args.otherAgentCapable),
      otherAgentId: args.otherAgentId ?? null,
    },
    result: {
      recommendation: recommendationForBusyAction(action, args.newTaskTitle, args.otherAgentId ?? null),
    },
  })
}

export async function listRuntimeMicroOperationDecisions(args: {
  policyId?: string
  status?: RuntimeMicroOperationDecisionStatus
  limit?: number
} = {}): Promise<RuntimeMicroOperationDecisionRow[]> {
  const filters: SQL[] = []
  if (args.policyId) filters.push(eq(schema.runtimeMicroOperationDecisions.policyId, args.policyId))
  if (args.status) filters.push(eq(schema.runtimeMicroOperationDecisions.status, args.status))
  return db.query.runtimeMicroOperationDecisions.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.runtimeMicroOperationDecisions.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function createScheduledAction(args: CreateScheduledActionArgs): Promise<ScheduledActionRow> {
  const now = Date.now()
  const row: ScheduledActionRow = {
    id: newScheduledActionId(),
    agentProfileId: args.agentProfileId ?? null,
    instruction: args.instruction,
    dueAt: args.dueAt,
    status: 'scheduled',
    payload: args.payload ?? {},
    result: {},
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.scheduledActions).values(row)
  return row
}

export async function runDueScheduledActions(
  args: RunDueScheduledActionsArgs = {},
): Promise<{ processed: ScheduledActionRow[]; queued: ScheduledActionRow[]; due: ScheduledActionRow[] }> {
  const now = args.now ?? Date.now()
  const busy = new Set(args.busyAgentIds ?? [])
  const candidates = await db.query.scheduledActions.findMany({
    where: eq(schema.scheduledActions.status, 'scheduled'),
    orderBy: [schema.scheduledActions.dueAt],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
  const dueRows = candidates.filter((row) => row.dueAt <= now)
  const processed: ScheduledActionRow[] = []
  const queued: ScheduledActionRow[] = []
  const due: ScheduledActionRow[] = []
  for (const row of dueRows) {
    const nextStatus: ScheduledActionStatus =
      row.agentProfileId && busy.has(row.agentProfileId) ? 'queued' : 'due'
    const result: JsonObject = nextStatus === 'queued'
      ? { reason: 'agent_busy', queuedUntilCurrentTaskCompletes: true }
      : { wakeAgent: true, readyToExecute: true }
    const updated = { ...row, status: nextStatus, result, updatedAt: now }
    await db
      .update(schema.scheduledActions)
      .set({ status: nextStatus, result, updatedAt: now })
      .where(eq(schema.scheduledActions.id, row.id))
    processed.push(updated)
    if (nextStatus === 'queued') queued.push(updated)
    else due.push(updated)
  }
  return { processed, queued, due }
}

export async function listScheduledActions(args: {
  status?: ScheduledActionStatus
  limit?: number
} = {}): Promise<ScheduledActionRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.scheduledActions.status, args.status))
  return db.query.scheduledActions.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.scheduledActions.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function createInboxItem(args: CreateInboxItemArgs): Promise<AgentInboxItemRow> {
  const now = Date.now()
  const row: AgentInboxItemRow = {
    id: newAgentInboxItemId(),
    agentProfileId: args.agentProfileId ?? null,
    itemType: args.itemType,
    title: args.title,
    body: args.body ?? '',
    priority: args.priority ?? 0,
    status: 'unread',
    payload: args.payload ?? {},
    createdAt: now,
    updatedAt: now,
    processedAt: null,
  }
  await db.insert(schema.agentInboxItems).values(row)
  return row
}

export async function processNextInboxItem(args: {
  agentProfileId?: string | null
} = {}): Promise<AgentInboxItemRow | null> {
  const filters: SQL[] = [eq(schema.agentInboxItems.status, 'unread')]
  if (args.agentProfileId !== undefined) {
    if (args.agentProfileId === null) filters.push(isNull(schema.agentInboxItems.agentProfileId))
    else filters.push(eq(schema.agentInboxItems.agentProfileId, args.agentProfileId))
  }
  const row = await db.query.agentInboxItems.findFirst({
    where: and(...filters),
    orderBy: [desc(schema.agentInboxItems.priority), schema.agentInboxItems.createdAt],
  })
  if (!row) return null
  const now = Date.now()
  await db
    .update(schema.agentInboxItems)
    .set({ status: 'processing', updatedAt: now, processedAt: now })
    .where(eq(schema.agentInboxItems.id, row.id))
  return { ...row, status: 'processing', updatedAt: now, processedAt: now }
}

export async function listInboxItems(args: {
  status?: AgentInboxItemStatus
  itemType?: AgentInboxItemType
  limit?: number
} = {}): Promise<AgentInboxItemRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.agentInboxItems.status, args.status))
  if (args.itemType) filters.push(eq(schema.agentInboxItems.itemType, args.itemType))
  return db.query.agentInboxItems.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.agentInboxItems.priority), desc(schema.agentInboxItems.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

function mergePolicy(patch: PartialRuntimeMicroOperationPolicy | undefined): RuntimeMicroOperationPolicy {
  return {
    idleTimeout: {
      waitingForApproval: {
        ...defaultPolicy.idleTimeout.waitingForApproval,
        ...patch?.idleTimeout?.waitingForApproval,
      },
      agentIdle: {
        ...defaultPolicy.idleTimeout.agentIdle,
        ...patch?.idleTimeout?.agentIdle,
      },
      agentStuck: {
        ...defaultPolicy.idleTimeout.agentStuck,
        ...patch?.idleTimeout?.agentStuck,
      },
    },
    busyBehavior: {
      ...defaultPolicy.busyBehavior,
      ...patch?.busyBehavior,
    },
    delayedActions: {
      ...defaultPolicy.delayedActions,
      ...patch?.delayedActions,
    },
    inbox: {
      ...defaultPolicy.inbox,
      ...patch?.inbox,
      priorityOrder: patch?.inbox?.priorityOrder ?? defaultPolicy.inbox.priorityOrder,
    },
  }
}

function timeoutConfig(policy: RuntimeMicroOperationPolicy, kind: RuntimeTimeoutKind): {
  timeout: number
  noProgressSteps?: number
  onTimeout: RuntimeTimeoutAction
} {
  if (kind === 'waiting_for_approval') return policy.idleTimeout.waitingForApproval
  if (kind === 'agent_idle') return policy.idleTimeout.agentIdle
  return policy.idleTimeout.agentStuck
}

function notTimedOutAction(kind: RuntimeTimeoutKind): RuntimeTimeoutAction {
  if (kind === 'waiting_for_approval') return 'keep_waiting'
  if (kind === 'agent_idle') return 'do_nothing'
  return 'replan'
}

function statusFromTimeoutAction(
  action: RuntimeTimeoutAction,
  timedOut: boolean,
): RuntimeMicroOperationDecisionStatus {
  if (!timedOut) return 'continue'
  if (action === 'escalate') return 'escalated'
  if (action === 'ask_user') return 'needs_user'
  if (action === 'keep_waiting' || action === 'do_nothing') return 'continue'
  return 'planned'
}

function statusFromBusyAction(action: RuntimeBusyAction): RuntimeMicroOperationDecisionStatus {
  if (action === 'queue_after_current') return 'queued'
  if (action === 'delegate_to_other_agent') return 'delegated'
  if (action === 'ask_user') return 'needs_user'
  return 'planned'
}

function recommendationForTimeout(
  kind: RuntimeTimeoutKind,
  action: RuntimeTimeoutAction,
  timedOut: boolean,
): string {
  if (!timedOut) return `No timeout action is needed for ${kind}.`
  if (action === 'hibernate') return 'Hibernate the idle Agent and keep its checkpoint for later resume.'
  if (action === 'replan') return 'Ask the Agent to replan because it appears stuck.'
  if (action === 'auto_reject') return 'Auto-reject the stale approval request according to policy.'
  if (action === 'suggest_tasks') return 'Suggest useful next tasks while the Agent is idle.'
  if (action === 'escalate') return 'Escalate this timeout to the user or supervisor Agent.'
  if (action === 'ask_user') return 'Ask the user for help before continuing.'
  return 'Keep waiting according to policy.'
}

function recommendationForBusyAction(
  action: RuntimeBusyAction,
  newTaskTitle: string,
  otherAgentId: string | null,
): string {
  if (action === 'safe_pause_and_preempt') return `Safely pause current work and run ${newTaskTitle}.`
  if (action === 'delegate_to_other_agent') return `Delegate ${newTaskTitle} to ${otherAgentId ?? 'another capable Agent'}.`
  if (action === 'ask_user') return `Ask the user whether to interrupt current work for ${newTaskTitle}.`
  return `Queue ${newTaskTitle} until the current task finishes.`
}

async function recordDecision(args: {
  policyId: string
  agentProfileId: string | null
  decisionType: RuntimeMicroOperationDecisionRow['decisionType']
  action: RuntimeTimeoutAction | RuntimeBusyAction
  status: RuntimeMicroOperationDecisionStatus
  input: JsonObject
  result: JsonObject
}): Promise<RuntimeMicroOperationDecisionRow> {
  const row: RuntimeMicroOperationDecisionRow = {
    id: newRuntimeMicroOperationDecisionId(),
    policyId: args.policyId,
    agentProfileId: args.agentProfileId,
    decisionType: args.decisionType,
    action: args.action,
    status: args.status,
    input: args.input,
    result: args.result,
    createdAt: Date.now(),
  }
  await db.insert(schema.runtimeMicroOperationDecisions).values(row)
  return row
}

async function getRequiredPolicy(id: string): Promise<RuntimeMicroOperationPolicyRow> {
  const row = await db.query.runtimeMicroOperationPolicies.findFirst({
    where: eq(schema.runtimeMicroOperationPolicies.id, id),
  })
  if (!row) throw new Error(`Runtime micro-operation policy not found: ${id}`)
  return row
}
