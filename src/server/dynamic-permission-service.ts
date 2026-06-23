import { and, desc, eq, inArray, lt } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  AutonomyActionType,
  DynamicPermissionDuration,
  DynamicPermissionGrantRow,
  DynamicPermissionGrantStatus,
  JsonObject,
  RiskLevel,
} from '@/db/schema'
import { evaluateAutonomyAction } from '@/server/autonomy-policy-service'
import { createApprovalRequest } from '@/server/control-plane-service'
import { newDynamicPermissionGrantId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface RequestDynamicPermissionArgs {
  agentProfileId: string
  employeeRunId?: string | null
  permissionKey: string
  resourceType: string
  resourceId?: string | null
  duration?: DynamicPermissionDuration
  justification?: string
  riskLevel?: RiskLevel
  payload?: JsonObject
}

export interface ListDynamicPermissionGrantArgs {
  agentProfileId?: string
  employeeRunId?: string
  status?: DynamicPermissionGrantStatus
  permissionKey?: string
  limit?: number
}

export interface DowngradeDynamicPermissionArgs {
  agentProfileId?: string
  employeeRunId?: string
  permissionKeys?: string[]
  reason: string
}

const ACTIVE_STATUSES: DynamicPermissionGrantStatus[] = [
  'requested',
  'granted',
  'requires_approval',
]

const ACTION_BY_PERMISSION: Record<string, AutonomyActionType> = {
  'read:workspace': 'read_file',
  'write:file': 'write_file',
  'delete:file': 'delete_file',
  'command:run': 'run_command',
  'dependency:install': 'install_dependency',
  'network:external': 'network_request',
  'browser:operate': 'browser_operation',
  'desktop:operate': 'desktop_operation',
  'software:command': 'software_command',
  'mcp:tool': 'mcp_tool',
  'cli:profile': 'cli_profile',
  'mobile:operate': 'mobile_operation',
  'account:login': 'login',
  'payment:execute': 'payment',
  'message:send': 'send_message',
  'system:setting': 'system_setting',
}

export async function requestDynamicPermission(
  args: RequestDynamicPermissionArgs,
): Promise<DynamicPermissionGrantRow> {
  await expireDynamicPermissionGrants()
  const agent = await getRequiredAgent(args.agentProfileId)
  const permissionKey = args.permissionKey.trim()
  const actionType = actionTypeForPermission(permissionKey)
  const config = getRequestOnDemandConfig(agent, permissionKey)
  const duration = args.duration ?? readDuration(config, 'duration') ?? 'single_operation'
  const justification = args.justification?.trim() ?? ''
  const now = Date.now()
  const riskLevel = args.riskLevel ?? riskForAction(actionType)
  const policySnapshot: JsonObject = {
    basePermissions: readStringArray(agent.permissionPolicy.basePermissions),
    requestOnDemand: readObject(agent.permissionPolicy.requestOnDemand),
    autoRevokeOnTaskComplete: readBoolean(agent.permissionPolicy, 'autoRevokeOnTaskComplete'),
    autoDowngrade: readObject(agent.permissionPolicy.autoDowngrade),
  }

  if (readBoolean(config, 'requireJustification') && !justification) {
    return insertGrant({
      agent,
      employeeRunId: args.employeeRunId,
      permissionKey,
      actionType,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      duration,
      status: 'rejected',
      riskLevel,
      justification,
      reason: 'This permission requires a justification before it can be requested.',
      policySnapshot,
      now,
    })
  }

  const decisionResult = await evaluateAutonomyAction({
    agentProfileId: agent.id,
    actionType,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    requestedMode: 'execute',
    riskLevel,
    payload: {
      ...(args.payload ?? {}),
      permissionKey,
      duration,
      justification,
      dynamicPermission: true,
    },
  })

  const requiresApproval =
    decisionResult.decision.requiresApproval ||
    readString(config, 'requiresApproval') === 'always'
  let approvalRequestId: string | null = null
  const status: DynamicPermissionGrantStatus =
    decisionResult.decision.status === 'blocked'
      ? 'rejected'
      : requiresApproval
        ? 'requires_approval'
        : 'granted'
  let reason =
    decisionResult.decision.status === 'blocked'
      ? decisionResult.decision.reason
      : requiresApproval
        ? `Permission ${permissionKey} requires user approval.`
        : hasBasePermission(agent, permissionKey)
          ? `Permission ${permissionKey} is already covered by base permissions.`
          : `Permission ${permissionKey} was granted on demand for ${duration}.`

  if (requiresApproval && status === 'requires_approval') {
    const approval = await createApprovalRequest({
      runId: args.employeeRunId,
      agentProfileId: agent.id,
      type: 'dynamic_permission',
      title: `Grant ${permissionKey}`,
      description: justification || `Agent requested ${permissionKey} for ${args.resourceType}.`,
      riskLevel,
      payload: {
        permissionKey,
        actionType,
        resourceType: args.resourceType,
        resourceId: normalizeNullable(args.resourceId),
        duration,
        autonomyDecisionId: decisionResult.decision.id,
      },
    })
    approvalRequestId = approval.id
    reason = `Permission ${permissionKey} is waiting for approval ${approval.id}.`
  }

  return insertGrant({
    agent,
    employeeRunId: args.employeeRunId,
    permissionKey,
    actionType,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    duration,
    status,
    riskLevel,
    justification,
    reason,
    policySnapshot,
    autonomyDecisionId: decisionResult.decision.id,
    approvalRequestId,
    now,
  })
}

export async function listDynamicPermissionGrants(
  args: ListDynamicPermissionGrantArgs = {},
): Promise<DynamicPermissionGrantRow[]> {
  await expireDynamicPermissionGrants()
  const filters = [
    args.agentProfileId ? eq(schema.dynamicPermissionGrants.agentProfileId, args.agentProfileId) : undefined,
    args.employeeRunId ? eq(schema.dynamicPermissionGrants.employeeRunId, args.employeeRunId) : undefined,
    args.status ? eq(schema.dynamicPermissionGrants.status, args.status) : undefined,
    args.permissionKey ? eq(schema.dynamicPermissionGrants.permissionKey, args.permissionKey) : undefined,
  ].filter(Boolean)
  return db.query.dynamicPermissionGrants.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.dynamicPermissionGrants.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 500),
  })
}

export async function revokeDynamicPermissionGrant(
  id: string,
  reason = 'Permission was manually revoked.',
): Promise<DynamicPermissionGrantRow> {
  const existing = await getRequiredGrant(id)
  if (!ACTIVE_STATUSES.includes(existing.status)) return existing
  await updateGrantStatus(existing.id, 'revoked', reason)
  const updated = await getRequiredGrant(existing.id)
  await recordAuditLog({
    actorType: 'system',
    action: 'dynamic_permission.revoke',
    resourceType: updated.resourceType,
    resourceId: updated.resourceId,
    status: 'allowed',
    riskLevel: updated.riskLevel,
    message: reason,
    metadata: { dynamicPermissionGrantId: updated.id, permissionKey: updated.permissionKey },
  })
  return updated
}

export async function revokeDynamicPermissionsForCompletedRun(
  employeeRunId: string,
  reason = 'Task completed; dynamic permissions were automatically revoked.',
): Promise<DynamicPermissionGrantRow[]> {
  const grants = await db.query.dynamicPermissionGrants.findMany({
    where: and(
      eq(schema.dynamicPermissionGrants.employeeRunId, employeeRunId),
      inArray(schema.dynamicPermissionGrants.status, ACTIVE_STATUSES),
    ),
  })
  for (const grant of grants) {
    const snapshot = grant.policySnapshot
    if (readBoolean(snapshot, 'autoRevokeOnTaskComplete') || grant.duration === 'this_task') {
      await updateGrantStatus(grant.id, 'revoked', reason)
    }
  }
  return listDynamicPermissionGrants({ employeeRunId, limit: 500 })
}

export async function downgradeDynamicPermissionsForAnomaly(
  args: DowngradeDynamicPermissionArgs,
): Promise<DynamicPermissionGrantRow[]> {
  if (!args.agentProfileId && !args.employeeRunId) {
    throw new Error('agentProfileId or employeeRunId is required to downgrade dynamic permissions.')
  }
  const filters = [
    args.agentProfileId ? eq(schema.dynamicPermissionGrants.agentProfileId, args.agentProfileId) : undefined,
    args.employeeRunId ? eq(schema.dynamicPermissionGrants.employeeRunId, args.employeeRunId) : undefined,
    inArray(schema.dynamicPermissionGrants.status, ACTIVE_STATUSES),
  ].filter(Boolean)
  const grants = await db.query.dynamicPermissionGrants.findMany({
    where: and(...filters),
  })
  const permissionKeys = new Set(args.permissionKeys?.map((key) => key.trim()).filter(Boolean) ?? [])
  const affected = permissionKeys.size
    ? grants.filter((grant) => permissionKeys.has(grant.permissionKey))
    : grants
  for (const grant of affected) {
    await updateGrantStatus(grant.id, 'downgraded', args.reason)
  }
  if (affected.length > 0) {
    await recordAuditLog({
      actorType: 'system',
      actorId: args.agentProfileId ?? null,
      action: 'dynamic_permission.downgrade',
      resourceType: args.employeeRunId ? 'employee_run' : 'agent_profile',
      resourceId: args.employeeRunId ?? args.agentProfileId ?? null,
      status: 'warning',
      riskLevel: 'medium',
      message: args.reason,
      metadata: {
        affectedGrantIds: affected.map((grant) => grant.id),
        permissionKeys: [...permissionKeys],
      },
    })
  }
  return listDynamicPermissionGrants({
    agentProfileId: args.agentProfileId,
    employeeRunId: args.employeeRunId,
    limit: 500,
  })
}

export async function expireDynamicPermissionGrants(now = Date.now()): Promise<number> {
  const grants = await db.query.dynamicPermissionGrants.findMany({
    where: and(
      inArray(schema.dynamicPermissionGrants.status, ACTIVE_STATUSES),
      lt(schema.dynamicPermissionGrants.expiresAt, now),
    ),
  })
  for (const grant of grants) {
    await updateGrantStatus(grant.id, 'expired', 'Dynamic permission duration expired.', now)
  }
  return grants.length
}

async function insertGrant(args: {
  agent: AgentProfileRow
  employeeRunId?: string | null
  permissionKey: string
  actionType: AutonomyActionType
  resourceType: string
  resourceId?: string | null
  duration: DynamicPermissionDuration
  status: DynamicPermissionGrantStatus
  riskLevel: RiskLevel
  justification: string
  reason: string
  policySnapshot: JsonObject
  autonomyDecisionId?: string | null
  approvalRequestId?: string | null
  now: number
}): Promise<DynamicPermissionGrantRow> {
  const row: DynamicPermissionGrantRow = {
    id: newDynamicPermissionGrantId(),
    agentProfileId: args.agent.id,
    employeeRunId: normalizeNullable(args.employeeRunId),
    permissionKey: args.permissionKey,
    actionType: args.actionType,
    resourceType: args.resourceType.trim(),
    resourceId: normalizeNullable(args.resourceId),
    duration: args.duration,
    status: args.status,
    riskLevel: args.riskLevel,
    justification: args.justification,
    reason: args.reason,
    policySnapshot: args.policySnapshot,
    autonomyDecisionId: args.autonomyDecisionId ?? null,
    approvalRequestId: args.approvalRequestId ?? null,
    createdAt: args.now,
    updatedAt: args.now,
    expiresAt: expiresAtForDuration(args.duration, args.now),
    revokedAt: terminalStatus(args.status) ? args.now : null,
  }
  await db.insert(schema.dynamicPermissionGrants).values(row)
  await recordAuditLog({
    actorType: 'agent',
    actorId: args.agent.id,
    action: `dynamic_permission.${args.status}`,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    status: auditStatusForGrant(row.status),
    riskLevel: row.riskLevel,
    message: row.reason,
    metadata: {
      dynamicPermissionGrantId: row.id,
      permissionKey: row.permissionKey,
      duration: row.duration,
      approvalRequestId: row.approvalRequestId,
      autonomyDecisionId: row.autonomyDecisionId,
    },
  })
  return row
}

async function updateGrantStatus(
  id: string,
  status: DynamicPermissionGrantStatus,
  reason: string,
  now = Date.now(),
): Promise<void> {
  await db
    .update(schema.dynamicPermissionGrants)
    .set({
      status,
      reason,
      updatedAt: now,
      revokedAt: terminalStatus(status) ? now : null,
    })
    .where(eq(schema.dynamicPermissionGrants.id, id))
}

async function getRequiredAgent(id: string): Promise<AgentProfileRow> {
  const agent = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, id),
  })
  if (!agent) throw new Error(`Agent profile not found: ${id}`)
  return agent
}

async function getRequiredGrant(id: string): Promise<DynamicPermissionGrantRow> {
  const grant = await db.query.dynamicPermissionGrants.findFirst({
    where: eq(schema.dynamicPermissionGrants.id, id),
  })
  if (!grant) throw new Error(`Dynamic permission grant not found: ${id}`)
  return grant
}

function actionTypeForPermission(permissionKey: string): AutonomyActionType {
  return ACTION_BY_PERMISSION[permissionKey] ?? 'mcp_tool'
}

function riskForAction(actionType: AutonomyActionType): RiskLevel {
  if (actionType === 'read_file' || actionType === 'browser_operation') return 'low'
  if (
    actionType === 'write_file' ||
    actionType === 'run_command' ||
    actionType === 'network_request' ||
    actionType === 'software_command' ||
    actionType === 'mcp_tool' ||
    actionType === 'cli_profile'
  ) {
    return 'medium'
  }
  return 'high'
}

function hasBasePermission(agent: AgentProfileRow, permissionKey: string): boolean {
  return readStringArray(agent.permissionPolicy.basePermissions).includes(permissionKey)
}

function getRequestOnDemandConfig(agent: AgentProfileRow, permissionKey: string): JsonObject {
  const requestOnDemand = readObject(agent.permissionPolicy.requestOnDemand)
  const config = requestOnDemand[permissionKey]
  return config && typeof config === 'object' && !Array.isArray(config)
    ? (config as JsonObject)
    : {}
}

function readObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

function readString(value: JsonObject, key: string): string | null {
  const raw = value[key]
  return typeof raw === 'string' ? raw : null
}

function readBoolean(value: JsonObject, key: string): boolean {
  return value[key] === true
}

function readDuration(value: JsonObject, key: string): DynamicPermissionDuration | null {
  const raw = readString(value, key)
  return raw === 'single_operation' || raw === 'this_step' || raw === 'this_task' ? raw : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function expiresAtForDuration(duration: DynamicPermissionDuration, now: number): number {
  if (duration === 'single_operation') return now + 15 * 60 * 1000
  if (duration === 'this_step') return now + 60 * 60 * 1000
  return now + 8 * 60 * 60 * 1000
}

function terminalStatus(status: DynamicPermissionGrantStatus): boolean {
  return status === 'rejected' || status === 'revoked' || status === 'downgraded' || status === 'expired'
}

function auditStatusForGrant(
  status: DynamicPermissionGrantStatus,
): 'allowed' | 'blocked' | 'warning' {
  if (status === 'granted') return 'allowed'
  if (status === 'rejected') return 'blocked'
  return 'warning'
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}
