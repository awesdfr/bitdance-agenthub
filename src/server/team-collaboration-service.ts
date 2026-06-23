import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  RiskLevel,
  TeamApprovalDecisionRow,
  TeamApprovalDecisionValue,
  TeamApprovalMode,
  TeamApprovalPolicyRow,
  TeamApprovalResolution,
  TeamMembershipRow,
  TeamResourceShareRow,
  TeamResourceSharingPolicy,
  TeamResourceType,
  TeamRow,
  TeamSecretHandling,
  TeamUserRoleSystem,
  TeamUserRow,
} from '@/db/schema'
import {
  newTeamApprovalDecisionId,
  newTeamApprovalPolicyId,
  newTeamId,
  newTeamMembershipId,
  newTeamResourceShareId,
  newTeamUserId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export const TEAM_PERMISSION_KEYS = [
  'agent:create',
  'agent:edit',
  'agent:delete',
  'agent:run',
  'workflow:create',
  'workflow:run',
  'model:manage',
  'skill:install',
  'memory:view',
  'memory:edit',
  'memory:delete',
  'approval:decide',
  'billing:view',
  'system:settings',
  'audit:view',
] as const

export type TeamPermissionKey = typeof TEAM_PERMISSION_KEYS[number] | (string & {})
export type TeamPermissions = Record<string, boolean>

export interface CreateTeamUserArgs {
  displayName: string
  email: string
  roleSystem?: TeamUserRoleSystem
  permissions?: TeamPermissions
  scope?: string
  status?: TeamUserRow['status']
}

export interface CreateTeamArgs {
  name: string
  description?: string
  status?: TeamRow['status']
}

export interface AddTeamMemberArgs {
  teamId: string
  userId: string
  roleSystem?: TeamUserRoleSystem
  permissions?: TeamPermissions
  scope?: string
  status?: TeamMembershipRow['status']
}

export interface EvaluateTeamPermissionArgs {
  userId: string
  teamId?: string | null
  permission: TeamPermissionKey
  scope?: string | null
}

export interface TeamPermissionEvaluation {
  userId: string
  teamId: string | null
  permission: string
  scope: string | null
  allowed: boolean
  source: 'user_role' | 'team_membership' | 'none'
  matchedRole: TeamUserRoleSystem | null
  reasons: string[]
}

export interface ShareTeamResourceArgs {
  teamId: string
  resourceType: TeamResourceType
  resourceId: string
  sharingPolicy?: TeamResourceSharingPolicy
  secretHandling?: TeamSecretHandling
  createdByUserId?: string | null
  metadata?: JsonObject
}

export interface CreateTeamApprovalPolicyArgs {
  teamId: string
  name: string
  approvalMode: TeamApprovalMode
  approverUserIds?: string[]
  requiredPermission?: string
  riskLevel?: RiskLevel
  status?: TeamApprovalPolicyRow['status']
}

export interface RecordTeamApprovalDecisionArgs {
  policyId: string
  approvalRequestId?: string | null
  userId: string
  decision: TeamApprovalDecisionValue
  comment?: string
}

export const DEFAULT_ROLE_PERMISSIONS: Record<TeamUserRoleSystem, TeamPermissions> = {
  admin: Object.fromEntries(TEAM_PERMISSION_KEYS.map((key) => [key, true])),
  operator: {
    'agent:create': true,
    'agent:edit': true,
    'agent:delete': false,
    'agent:run': true,
    'workflow:create': true,
    'workflow:run': true,
    'model:manage': false,
    'skill:install': true,
    'memory:view': true,
    'memory:edit': true,
    'memory:delete': false,
    'approval:decide': true,
    'billing:view': false,
    'system:settings': false,
    'audit:view': true,
  },
  viewer: {
    'agent:create': false,
    'agent:edit': false,
    'agent:delete': false,
    'agent:run': false,
    'workflow:create': false,
    'workflow:run': false,
    'model:manage': false,
    'skill:install': false,
    'memory:view': true,
    'memory:edit': false,
    'memory:delete': false,
    'approval:decide': false,
    'billing:view': false,
    'system:settings': false,
    'audit:view': true,
  },
  custom: {},
}

export async function createTeamUser(args: CreateTeamUserArgs): Promise<TeamUserRow> {
  const now = Date.now()
  const row: TeamUserRow = {
    id: newTeamUserId(),
    displayName: normalizeRequired(args.displayName, 'displayName'),
    email: normalizeRequired(args.email, 'email').toLowerCase(),
    roleSystem: args.roleSystem ?? 'viewer',
    permissions: normalizePermissions(args.permissions),
    scope: normalizeScope(args.scope),
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.teamUsers).values(row)
  await auditTeamAction({
    actorType: 'system',
    action: 'team_user.create',
    resourceType: 'team_user',
    resourceId: row.id,
    message: `Team user ${row.email} created with ${row.roleSystem} role.`,
    metadata: { roleSystem: row.roleSystem, scope: row.scope },
  })
  return row
}

export async function listTeamUsers(args: {
  roleSystem?: TeamUserRoleSystem
  status?: TeamUserRow['status']
  limit?: number
} = {}): Promise<TeamUserRow[]> {
  const filters: SQL[] = []
  if (args.roleSystem) filters.push(eq(schema.teamUsers.roleSystem, args.roleSystem))
  if (args.status) filters.push(eq(schema.teamUsers.status, args.status))
  return db.query.teamUsers.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.teamUsers.createdAt)],
    limit: normalizeLimit(args.limit),
  })
}

export async function createTeam(args: CreateTeamArgs): Promise<TeamRow> {
  const now = Date.now()
  const row: TeamRow = {
    id: newTeamId(),
    name: normalizeRequired(args.name, 'name'),
    description: args.description?.trim() ?? '',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.teams).values(row)
  await auditTeamAction({
    actorType: 'system',
    action: 'team.create',
    resourceType: 'team',
    resourceId: row.id,
    message: `Team ${row.name} created.`,
  })
  return row
}

export async function listTeams(args: {
  status?: TeamRow['status']
  limit?: number
} = {}): Promise<TeamRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.teams.status, args.status))
  return db.query.teams.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.teams.updatedAt)],
    limit: normalizeLimit(args.limit),
  })
}

export async function addTeamMember(args: AddTeamMemberArgs): Promise<TeamMembershipRow> {
  await getRequiredTeam(args.teamId)
  await getRequiredTeamUser(args.userId)
  const now = Date.now()
  const row: TeamMembershipRow = {
    id: newTeamMembershipId(),
    teamId: args.teamId,
    userId: args.userId,
    roleSystem: args.roleSystem ?? 'viewer',
    permissions: normalizePermissions(args.permissions),
    scope: normalizeScope(args.scope),
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.teamMemberships).values(row)
  await auditTeamAction({
    actorType: 'system',
    action: 'team_member.add',
    resourceType: 'team_membership',
    resourceId: row.id,
    message: `User ${row.userId} added to team ${row.teamId} as ${row.roleSystem}.`,
    metadata: { teamId: row.teamId, userId: row.userId, roleSystem: row.roleSystem, scope: row.scope },
  })
  return row
}

export async function listTeamMemberships(args: {
  teamId?: string
  userId?: string
  status?: TeamMembershipRow['status']
  limit?: number
} = {}): Promise<TeamMembershipRow[]> {
  const filters: SQL[] = []
  if (args.teamId) filters.push(eq(schema.teamMemberships.teamId, args.teamId))
  if (args.userId) filters.push(eq(schema.teamMemberships.userId, args.userId))
  if (args.status) filters.push(eq(schema.teamMemberships.status, args.status))
  return db.query.teamMemberships.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.teamMemberships.createdAt)],
    limit: normalizeLimit(args.limit),
  })
}

export async function evaluateTeamPermission(
  args: EvaluateTeamPermissionArgs,
): Promise<TeamPermissionEvaluation> {
  const user = await getRequiredTeamUser(args.userId)
  const requestedScope = normalizeNullable(args.scope)
  const reasons: string[] = []
  if (user.status !== 'active') {
    return permissionResult(args, requestedScope, false, 'none', null, ['User is disabled.'])
  }

  const userAllowed = roleAllows(user.roleSystem, user.permissions as TeamPermissions, args.permission)
  if (userAllowed && scopeAllows(user.scope, requestedScope)) {
    return permissionResult(args, requestedScope, true, 'user_role', user.roleSystem, [
      `Allowed by user ${user.roleSystem} role.`,
    ])
  }
  reasons.push(
    userAllowed
      ? `User role is scoped to ${user.scope}.`
      : `User ${user.roleSystem} role does not grant ${args.permission}.`,
  )

  if (args.teamId) {
    const memberships = await listTeamMemberships({
      teamId: args.teamId,
      userId: args.userId,
      status: 'active',
      limit: 20,
    })
    for (const membership of memberships) {
      const membershipAllowed = roleAllows(
        membership.roleSystem,
        membership.permissions as TeamPermissions,
        args.permission,
      )
      if (membershipAllowed && scopeAllows(membership.scope, requestedScope)) {
        return permissionResult(args, requestedScope, true, 'team_membership', membership.roleSystem, [
          `Allowed by ${membership.roleSystem} membership in team ${membership.teamId}.`,
        ])
      }
      reasons.push(
        membershipAllowed
          ? `Team membership ${membership.id} is scoped to ${membership.scope}.`
          : `Team membership ${membership.id} does not grant ${args.permission}.`,
      )
    }
  }

  return permissionResult(args, requestedScope, false, 'none', null, reasons)
}

export async function shareTeamResource(args: ShareTeamResourceArgs): Promise<TeamResourceShareRow> {
  await getRequiredTeam(args.teamId)
  if (args.createdByUserId) await getRequiredTeamUser(args.createdByUserId)
  const now = Date.now()
  const row: TeamResourceShareRow = {
    id: newTeamResourceShareId(),
    teamId: args.teamId,
    resourceType: args.resourceType,
    resourceId: normalizeRequired(args.resourceId, 'resourceId'),
    sharingPolicy: args.sharingPolicy ?? defaultSharingPolicy(args.resourceType),
    secretHandling: args.secretHandling ?? defaultSecretHandling(args.resourceType),
    createdByUserId: normalizeNullable(args.createdByUserId),
    metadata: args.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.teamResourceShares).values(row)
  await auditTeamAction({
    actorType: row.createdByUserId ? 'user' : 'system',
    actorId: row.createdByUserId,
    action: 'team_resource.share',
    resourceType: 'team_resource_share',
    resourceId: row.id,
    riskLevel: row.secretHandling === 'shared_reference' ? 'medium' : 'low',
    message: `${row.resourceType} ${row.resourceId} shared with team ${row.teamId}.`,
    metadata: {
      teamId: row.teamId,
      resourceType: row.resourceType,
      sharingPolicy: row.sharingPolicy,
      secretHandling: row.secretHandling,
    },
  })
  return row
}

export async function listTeamResourceShares(args: {
  teamId?: string
  resourceType?: TeamResourceType
  resourceId?: string
  sharingPolicy?: TeamResourceSharingPolicy
  limit?: number
} = {}): Promise<TeamResourceShareRow[]> {
  const filters: SQL[] = []
  if (args.teamId) filters.push(eq(schema.teamResourceShares.teamId, args.teamId))
  if (args.resourceType) filters.push(eq(schema.teamResourceShares.resourceType, args.resourceType))
  if (args.resourceId) filters.push(eq(schema.teamResourceShares.resourceId, args.resourceId))
  if (args.sharingPolicy) filters.push(eq(schema.teamResourceShares.sharingPolicy, args.sharingPolicy))
  return db.query.teamResourceShares.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.teamResourceShares.createdAt)],
    limit: normalizeLimit(args.limit),
  })
}

export async function createTeamApprovalPolicy(
  args: CreateTeamApprovalPolicyArgs,
): Promise<TeamApprovalPolicyRow> {
  await getRequiredTeam(args.teamId)
  const approverUserIds = uniqueStrings(args.approverUserIds ?? [])
  validateApprovalMode(args.approvalMode, approverUserIds)
  for (const userId of approverUserIds) await getRequiredTeamUser(userId)
  const now = Date.now()
  const row: TeamApprovalPolicyRow = {
    id: newTeamApprovalPolicyId(),
    teamId: args.teamId,
    name: normalizeRequired(args.name, 'name'),
    approvalMode: args.approvalMode,
    approverUserIds,
    requiredPermission: normalizeRequired(args.requiredPermission ?? 'approval:decide', 'requiredPermission'),
    riskLevel: args.riskLevel ?? 'medium',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.teamApprovalPolicies).values(row)
  await auditTeamAction({
    actorType: 'system',
    action: 'team_approval_policy.create',
    resourceType: 'team_approval_policy',
    resourceId: row.id,
    riskLevel: row.riskLevel,
    message: `Approval policy ${row.name} created for team ${row.teamId}.`,
    metadata: {
      teamId: row.teamId,
      approvalMode: row.approvalMode,
      approverUserIds: row.approverUserIds,
      requiredPermission: row.requiredPermission,
    },
  })
  return row
}

export async function listTeamApprovalPolicies(args: {
  teamId?: string
  approvalMode?: TeamApprovalMode
  status?: TeamApprovalPolicyRow['status']
  limit?: number
} = {}): Promise<TeamApprovalPolicyRow[]> {
  const filters: SQL[] = []
  if (args.teamId) filters.push(eq(schema.teamApprovalPolicies.teamId, args.teamId))
  if (args.approvalMode) filters.push(eq(schema.teamApprovalPolicies.approvalMode, args.approvalMode))
  if (args.status) filters.push(eq(schema.teamApprovalPolicies.status, args.status))
  return db.query.teamApprovalPolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.teamApprovalPolicies.createdAt)],
    limit: normalizeLimit(args.limit),
  })
}

export async function recordTeamApprovalDecision(
  args: RecordTeamApprovalDecisionArgs,
): Promise<TeamApprovalDecisionRow> {
  const policy = await getRequiredTeamApprovalPolicy(args.policyId)
  if (policy.status !== 'active') throw new Error(`Approval policy is ${policy.status}: ${policy.id}`)
  await getRequiredTeamUser(args.userId)
  if (!isEligibleApprover(policy, args.userId)) {
    throw new Error(`User ${args.userId} is not an eligible approver for ${policy.approvalMode}.`)
  }
  const permission = await evaluateTeamPermission({
    userId: args.userId,
    teamId: policy.teamId,
    permission: policy.requiredPermission,
    scope: 'global',
  })
  if (!permission.allowed) {
    throw new Error(`User ${args.userId} lacks required permission ${policy.requiredPermission}.`)
  }

  const row: TeamApprovalDecisionRow = {
    id: newTeamApprovalDecisionId(),
    policyId: policy.id,
    approvalRequestId: normalizeNullable(args.approvalRequestId),
    userId: args.userId,
    decision: args.decision,
    comment: args.comment?.trim() ?? '',
    createdAt: Date.now(),
  }
  await db.insert(schema.teamApprovalDecisions).values(row)
  await auditTeamAction({
    actorType: 'user',
    actorId: row.userId,
    action: 'team_approval.decide',
    resourceType: 'team_approval_policy',
    resourceId: policy.id,
    status: row.decision === 'approved' ? 'allowed' : 'warning',
    riskLevel: policy.riskLevel,
    message: `User ${row.userId} ${row.decision} approval policy ${policy.name}.`,
    metadata: {
      decisionId: row.id,
      approvalMode: policy.approvalMode,
      approvalRequestId: row.approvalRequestId,
    },
  })
  return row
}

export async function listTeamApprovalDecisions(args: {
  policyId?: string
  userId?: string
  limit?: number
} = {}): Promise<TeamApprovalDecisionRow[]> {
  const filters: SQL[] = []
  if (args.policyId) filters.push(eq(schema.teamApprovalDecisions.policyId, args.policyId))
  if (args.userId) filters.push(eq(schema.teamApprovalDecisions.userId, args.userId))
  return db.query.teamApprovalDecisions.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.teamApprovalDecisions.createdAt)],
    limit: normalizeLimit(args.limit),
  })
}

export async function evaluateTeamApprovalPolicy(policyId: string): Promise<TeamApprovalResolution> {
  const policy = await getRequiredTeamApprovalPolicy(policyId)
  if (policy.status !== 'active') {
    return {
      status: 'pending',
      approvedBy: [],
      rejectedBy: [],
      missingApproverIds: policy.approverUserIds,
      reason: `Approval policy is ${policy.status}.`,
    }
  }
  const latest = collapseLatestDecisions(await listTeamApprovalDecisions({ policyId, limit: 500 }))
  const approvedBy = latest.filter((decision) => decision.decision === 'approved').map((decision) => decision.userId)
  const rejectedBy = latest.filter((decision) => decision.decision === 'rejected').map((decision) => decision.userId)

  if (policy.approvalMode === 'any_approver') {
    if (approvedBy.length) {
      return buildApprovalResolution('approved', approvedBy, rejectedBy, [], 'At least one permitted approver approved.')
    }
    return buildApprovalResolution(
      'pending',
      approvedBy,
      rejectedBy,
      [],
      rejectedBy.length
        ? 'No permitted approver has approved yet; rejection does not close any-approver policy.'
        : 'Waiting for any user with approval permission.',
    )
  }

  if (policy.approvalMode === 'specific_user') {
    const targetUserId = policy.approverUserIds[0]
    if (rejectedBy.includes(targetUserId)) {
      return buildApprovalResolution('rejected', approvedBy, rejectedBy, [], 'Specific approver rejected.')
    }
    if (approvedBy.includes(targetUserId)) {
      return buildApprovalResolution('approved', approvedBy, rejectedBy, [], 'Specific approver approved.')
    }
    return buildApprovalResolution('pending', approvedBy, rejectedBy, [targetUserId], 'Waiting for specific approver.')
  }

  if (policy.approvalMode === 'all_must_approve') {
    const missing = policy.approverUserIds.filter((userId) => !approvedBy.includes(userId))
    if (policy.approverUserIds.some((userId) => rejectedBy.includes(userId))) {
      return buildApprovalResolution('rejected', approvedBy, rejectedBy, missing, 'At least one required approver rejected.')
    }
    if (missing.length === 0) {
      return buildApprovalResolution('approved', approvedBy, rejectedBy, [], 'All required approvers approved.')
    }
    return buildApprovalResolution('pending', approvedBy, rejectedBy, missing, 'Waiting for all required approvers.')
  }

  const missing = policy.approverUserIds.filter(
    (userId) => !approvedBy.includes(userId) && !rejectedBy.includes(userId),
  )
  if (approvedBy.some((userId) => policy.approverUserIds.includes(userId))) {
    return buildApprovalResolution('approved', approvedBy, rejectedBy, missing, 'One of the allowed approvers approved.')
  }
  if (missing.length === 0 && policy.approverUserIds.every((userId) => rejectedBy.includes(userId))) {
    return buildApprovalResolution('rejected', approvedBy, rejectedBy, [], 'All candidate approvers rejected.')
  }
  return buildApprovalResolution('pending', approvedBy, rejectedBy, missing, 'Waiting for one approver from the list.')
}

async function getRequiredTeamUser(userId: string): Promise<TeamUserRow> {
  const row = await db.query.teamUsers.findFirst({ where: eq(schema.teamUsers.id, userId) })
  if (!row) throw new Error(`Team user not found: ${userId}`)
  return row
}

async function getRequiredTeam(teamId: string): Promise<TeamRow> {
  const row = await db.query.teams.findFirst({ where: eq(schema.teams.id, teamId) })
  if (!row) throw new Error(`Team not found: ${teamId}`)
  return row
}

async function getRequiredTeamApprovalPolicy(policyId: string): Promise<TeamApprovalPolicyRow> {
  const row = await db.query.teamApprovalPolicies.findFirst({
    where: eq(schema.teamApprovalPolicies.id, policyId),
  })
  if (!row) throw new Error(`Team approval policy not found: ${policyId}`)
  return row
}

function roleAllows(
  roleSystem: TeamUserRoleSystem,
  overrides: TeamPermissions,
  permission: string,
): boolean {
  if (overrides[permission] !== undefined) return overrides[permission]
  if (roleSystem === 'admin') return true
  return DEFAULT_ROLE_PERMISSIONS[roleSystem]?.[permission] ?? false
}

function scopeAllows(grantedScope: string, requestedScope: string | null): boolean {
  if (!requestedScope) return true
  if (grantedScope === 'global') return true
  return grantedScope === requestedScope
}

function permissionResult(
  args: EvaluateTeamPermissionArgs,
  requestedScope: string | null,
  allowed: boolean,
  source: TeamPermissionEvaluation['source'],
  matchedRole: TeamUserRoleSystem | null,
  reasons: string[],
): TeamPermissionEvaluation {
  return {
    userId: args.userId,
    teamId: args.teamId ?? null,
    permission: args.permission,
    scope: requestedScope,
    allowed,
    source,
    matchedRole,
    reasons,
  }
}

function defaultSharingPolicy(resourceType: TeamResourceType): TeamResourceSharingPolicy {
  return resourceType === 'memory' ? 'project_shared' : 'team_shared'
}

function defaultSecretHandling(resourceType: TeamResourceType): TeamSecretHandling {
  return resourceType === 'model_profile' ? 'user_isolated' : 'not_applicable'
}

function validateApprovalMode(approvalMode: TeamApprovalMode, approverUserIds: string[]): void {
  if (approvalMode === 'specific_user' && approverUserIds.length !== 1) {
    throw new Error('specific_user approval requires exactly one approver.')
  }
  if (
    (approvalMode === 'all_must_approve' || approvalMode === 'one_of_many') &&
    approverUserIds.length === 0
  ) {
    throw new Error(`${approvalMode} approval requires at least one approver.`)
  }
}

function isEligibleApprover(policy: TeamApprovalPolicyRow, userId: string): boolean {
  if (policy.approvalMode === 'any_approver') return true
  return policy.approverUserIds.includes(userId)
}

function collapseLatestDecisions(decisions: TeamApprovalDecisionRow[]): TeamApprovalDecisionRow[] {
  const byUser = new Map<string, TeamApprovalDecisionRow>()
  for (const decision of decisions) {
    if (!byUser.has(decision.userId)) byUser.set(decision.userId, decision)
  }
  return Array.from(byUser.values())
}

function buildApprovalResolution(
  status: TeamApprovalResolution['status'],
  approvedBy: string[],
  rejectedBy: string[],
  missingApproverIds: string[],
  reason: string,
): TeamApprovalResolution {
  return {
    status,
    approvedBy: uniqueStrings(approvedBy),
    rejectedBy: uniqueStrings(rejectedBy),
    missingApproverIds: uniqueStrings(missingApproverIds),
    reason,
  }
}

async function auditTeamAction(args: {
  actorType: 'user' | 'agent' | 'system'
  actorId?: string | null
  action: string
  resourceType: string
  resourceId?: string | null
  status?: 'allowed' | 'blocked' | 'warning'
  riskLevel?: RiskLevel
  message?: string
  metadata?: JsonObject
}): Promise<void> {
  await recordAuditLog({
    actorType: args.actorType,
    actorId: args.actorId,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    status: args.status,
    riskLevel: args.riskLevel ?? 'low',
    message: args.message,
    metadata: args.metadata,
  })
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeScope(scope: string | undefined): string {
  return scope?.trim() || 'global'
}

function normalizePermissions(permissions: TeamPermissions | undefined): TeamPermissions {
  return Object.fromEntries(
    Object.entries(permissions ?? {}).map(([permission, allowed]) => [
      normalizeRequired(permission, 'permission'),
      Boolean(allowed),
    ]),
  )
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 100, 1), 500)
}
