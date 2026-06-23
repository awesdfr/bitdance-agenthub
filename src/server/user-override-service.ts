import { and, desc, eq, inArray } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AutonomyActionType,
  JsonObject,
  RunStatus,
  UserOverrideCommand,
  UserOverrideRow,
  UserOverrideTargetType,
  UserOverrideTrigger,
} from '@/db/schema'
import {
  cancelEmployeeRun,
  pauseEmployeeRun,
} from '@/server/employee-runtime-service'
import { newUserOverrideId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export const IRREVOCABLE_USER_COMMANDS: Record<UserOverrideCommand, string> = {
  STOP: 'Immediately stop matching Agent work.',
  UNDO: 'Register an undo request and require rollback/recovery handling.',
  PAUSE: 'Pause matching Agent work and wait for the user.',
  NEVER_DO_THIS_AGAIN: 'Persist a permanent user blacklist rule.',
  IGNORE_PREVIOUS_INSTRUCTION: 'Discard prior conflicting instructions to defend against prompt injection.',
}

export const USER_SOVEREIGNTY_RULES = [
  'The user is the manager; the Agent exists to help the user.',
  'If user instructions conflict with learned best practice, warn once and then obey unless law/safety policy forbids it.',
  'If user instructions may cause harm, warn clearly, record the risk, and require explicit user authority for continuation.',
  'If user instructions are illegal, refuse and explain the reason.',
  'Never hide information, deceive the user, or take actions the user is not aware of.',
  'If a request exceeds the Agent capability, state the limitation honestly and offer alternatives.',
]

export interface ApplyUserOverrideArgs {
  command: UserOverrideCommand
  targetType?: UserOverrideTargetType
  targetId?: string | null
  reason?: string
  trigger?: UserOverrideTrigger
  payload?: JsonObject
}

export interface UserOverrideBlockCheck {
  actionType: AutonomyActionType
  resourceType: string
  resourceId?: string | null
}

export async function applyUserOverride(args: ApplyUserOverrideArgs): Promise<UserOverrideRow> {
  const now = Date.now()
  const normalized = {
    command: args.command,
    targetType: args.targetType ?? 'workspace',
    targetId: normalizeNullable(args.targetId),
    reason: args.reason?.trim() ?? '',
    trigger: args.trigger ?? 'api',
    payload: args.payload ?? {},
  }
  let effects: JsonObject = {}
  let status: UserOverrideRow['status'] = 'applied'
  try {
    effects = await executeOverride(normalized)
    status = normalized.command === 'UNDO' ? 'recorded' : 'applied'
  } catch (err) {
    effects = { error: formatError(err) }
    status = 'failed'
  }

  const row: UserOverrideRow = {
    id: newUserOverrideId(),
    ...normalized,
    effects,
    status,
    createdAt: now,
    appliedAt: status === 'failed' ? null : now,
  }
  await db.insert(schema.userOverrides).values(row)
  await recordAuditLog({
    actorType: 'user',
    action: `user_override.${row.command.toLowerCase()}`,
    resourceType: row.targetType,
    resourceId: row.targetId,
    status: row.status === 'failed' ? 'blocked' : row.command === 'NEVER_DO_THIS_AGAIN' ? 'warning' : 'allowed',
    riskLevel: row.command === 'STOP' || row.command === 'NEVER_DO_THIS_AGAIN' ? 'medium' : 'low',
    message: `User override ${row.command} was ${row.status}.`,
    metadata: {
      userOverrideId: row.id,
      trigger: row.trigger,
      reason: row.reason,
      effects: row.effects,
    },
  })
  return row
}

export async function listUserOverrides(args: {
  command?: UserOverrideCommand | null
  targetType?: UserOverrideTargetType | null
  targetId?: string | null
  limit?: number
} = {}): Promise<UserOverrideRow[]> {
  const filters = [
    args.command ? eq(schema.userOverrides.command, args.command) : undefined,
    args.targetType ? eq(schema.userOverrides.targetType, args.targetType) : undefined,
    args.targetId ? eq(schema.userOverrides.targetId, args.targetId) : undefined,
  ].filter(Boolean)
  return db.query.userOverrides.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.userOverrides.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 500),
  })
}

export async function getUserOverrideBlockReason(
  args: UserOverrideBlockCheck,
): Promise<string | null> {
  const overrides = await db.query.userOverrides.findMany({
    where: and(
      eq(schema.userOverrides.command, 'NEVER_DO_THIS_AGAIN'),
      eq(schema.userOverrides.status, 'applied'),
    ),
    orderBy: [desc(schema.userOverrides.createdAt)],
    limit: 200,
  })
  const match = overrides.find((override) => matchesOverrideBlock(override, args))
  if (!match) return null
  return `User override NEVER_DO_THIS_AGAIN blocks ${args.actionType} on ${args.resourceType}${args.resourceId ? `:${args.resourceId}` : ''}.`
}

async function executeOverride(args: {
  command: UserOverrideCommand
  targetType: UserOverrideTargetType
  targetId: string | null
  reason: string
  trigger: UserOverrideTrigger
  payload: JsonObject
}): Promise<JsonObject> {
  if (args.command === 'STOP') return stopTargetRuns(args)
  if (args.command === 'PAUSE') return pauseTargetRuns(args)
  if (args.command === 'UNDO') {
    return {
      undoRegistered: true,
      requiresRollback: true,
      targetType: args.targetType,
      targetId: args.targetId,
    }
  }
  if (args.command === 'NEVER_DO_THIS_AGAIN') {
    return {
      blacklistActive: true,
      actionType: getString(args.payload, 'actionType'),
      resourceType: getString(args.payload, 'resourceType'),
      resourceId: getString(args.payload, 'resourceId'),
    }
  }
  return {
    instructionWindowReset: true,
    ignoredPriorInstructions: true,
    targetType: args.targetType,
    targetId: args.targetId,
  }
}

async function stopTargetRuns(args: {
  targetType: UserOverrideTargetType
  targetId: string | null
}): Promise<JsonObject> {
  const runs = await findTargetRuns(args, ['queued', 'running', 'paused'])
  const stoppedRunIds: string[] = []
  const errors: JsonObject[] = []
  for (const run of runs) {
    try {
      const stopped = await cancelEmployeeRun(run.id)
      stoppedRunIds.push(stopped.id)
    } catch (err) {
      errors.push({ runId: run.id, error: formatError(err) })
    }
  }
  return {
    stoppedRunIds,
    stoppedCount: stoppedRunIds.length,
    errors,
  }
}

async function pauseTargetRuns(args: {
  targetType: UserOverrideTargetType
  targetId: string | null
}): Promise<JsonObject> {
  const runs = await findTargetRuns(args, ['queued', 'running'])
  const pausedRunIds: string[] = []
  const errors: JsonObject[] = []
  for (const run of runs) {
    try {
      const paused = await pauseEmployeeRun(run.id)
      pausedRunIds.push(paused.id)
    } catch (err) {
      errors.push({ runId: run.id, error: formatError(err) })
    }
  }
  return {
    pausedRunIds,
    pausedCount: pausedRunIds.length,
    errors,
  }
}

async function findTargetRuns(
  args: {
    targetType: UserOverrideTargetType
    targetId: string | null
  },
  statuses: RunStatus[],
) {
  if (args.targetType === 'employee_run' && args.targetId) {
    return db.query.employeeRuns.findMany({
      where: and(
        eq(schema.employeeRuns.id, args.targetId),
        inArray(schema.employeeRuns.status, statuses),
      ),
    })
  }
  if (args.targetType === 'agent_profile' && args.targetId) {
    return db.query.employeeRuns.findMany({
      where: and(
        eq(schema.employeeRuns.agentProfileId, args.targetId),
        inArray(schema.employeeRuns.status, statuses),
      ),
      orderBy: [desc(schema.employeeRuns.createdAt)],
      limit: 100,
    })
  }
  if (args.targetType === 'global' || args.targetType === 'workspace' || !args.targetId) {
    return db.query.employeeRuns.findMany({
      where: inArray(schema.employeeRuns.status, statuses),
      orderBy: [desc(schema.employeeRuns.createdAt)],
      limit: 200,
    })
  }
  return []
}

function matchesOverrideBlock(
  override: UserOverrideRow,
  args: UserOverrideBlockCheck,
): boolean {
  const payloadActionType = getString(override.payload, 'actionType')
  const payloadResourceType = getString(override.payload, 'resourceType')
  const payloadResourceId = getString(override.payload, 'resourceId')
  const actionMatches = !payloadActionType || payloadActionType === args.actionType
  const resourceTypeMatches = !payloadResourceType || payloadResourceType === args.resourceType
  const resourceIdMatches = !payloadResourceId || payloadResourceId === args.resourceId
  const targetMatches =
    override.targetType === 'global' ||
    override.targetType === 'workspace' ||
    (override.targetType === 'resource' &&
      Boolean(override.targetId) &&
      (override.targetId === args.resourceId ||
        override.targetId === `${args.resourceType}:${args.resourceId ?? ''}`))
  return actionMatches && resourceTypeMatches && resourceIdMatches && targetMatches
}

function getString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
