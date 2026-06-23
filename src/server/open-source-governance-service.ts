import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  CommunityGovernanceRoleRow,
  GovernanceRfcDecisionRow,
  GovernanceRfcStatus,
  GovernanceRoleType,
  JsonObject,
  OpenSourceComponentRow,
  OpenSourceGovernanceStatus,
  SourceLicenseLayer,
} from '@/db/schema'
import {
  newGovernanceRfcDecisionId,
  newGovernanceRoleId,
  newOpenSourceComponentId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateOpenSourceComponentArgs {
  layer: SourceLicenseLayer
  name: string
  scope?: string
  license: string
  sourceVisibility?: string
  commercialUse?: string
  authorPolicy?: string
  status?: OpenSourceGovernanceStatus
}

export interface CreateCommunityGovernanceRoleArgs {
  roleType: GovernanceRoleType
  name: string
  responsibilities?: string[]
  permissions?: string[]
  status?: OpenSourceGovernanceStatus
}

export interface CreateGovernanceRfcArgs {
  title: string
  summary?: string
  proposer?: string
  discussionUrl?: string | null
}

export interface AdvanceGovernanceRfcArgs {
  status: GovernanceRfcStatus
  discussionUrl?: string | null
  votesFor?: number
  votesAgainst?: number
  implementationNotes?: string
}

export interface OpenSourceGovernanceSeed {
  components: OpenSourceComponentRow[]
  roles: CommunityGovernanceRoleRow[]
}

const defaultComponents: CreateOpenSourceComponentArgs[] = [
  {
    layer: 'core_mit',
    name: 'Core runtime and service layer',
    scope: 'Runtime, services, CLI, and SDK',
    license: 'MIT',
    sourceVisibility: 'open_source',
    commercialUse: 'allowed_under_mit',
    authorPolicy: 'Project maintainers steward core changes through RFC and PR review.',
  },
  {
    layer: 'plus_commercial',
    name: 'Plus commercial layer',
    scope: 'Advanced Canvas, SSO, and compliance features',
    license: 'Commercial license required',
    sourceVisibility: 'source_visible',
    commercialUse: 'requires_commercial_authorization',
    authorPolicy: 'Commercial features remain reviewable but require a valid commercial grant.',
  },
  {
    layer: 'community_author',
    name: 'Community extension layer',
    scope: 'Community Skills, plugins, templates, and workflow packs',
    license: 'Author-defined',
    sourceVisibility: 'author_controlled',
    commercialUse: 'defined_by_author',
    authorPolicy: 'Each community author chooses their extension license and marketplace terms.',
  },
]

const defaultRoles: CreateCommunityGovernanceRoleArgs[] = [
  {
    roleType: 'maintainer',
    name: 'Maintainer',
    responsibilities: ['core commits', 'PR review', 'roadmap stewardship'],
    permissions: ['merge_core_pr', 'review_rfc', 'vote_roadmap'],
  },
  {
    roleType: 'contributor',
    name: 'Contributor',
    responsibilities: ['pull requests', 'bug reports', 'documentation'],
    permissions: ['open_pr', 'file_bug', 'edit_docs'],
  },
  {
    roleType: 'community_manager',
    name: 'Community Manager',
    responsibilities: ['Discord moderation', 'forum moderation', 'community onboarding'],
    permissions: ['moderate_discussion', 'triage_feedback'],
  },
  {
    roleType: 'plugin_author',
    name: 'Plugin Author',
    responsibilities: ['publish marketplace packages', 'maintain extension license'],
    permissions: ['publish_marketplace', 'manage_plugin_terms'],
  },
]

export async function createOpenSourceComponent(
  args: CreateOpenSourceComponentArgs,
): Promise<OpenSourceComponentRow> {
  const now = Date.now()
  const row: OpenSourceComponentRow = {
    id: newOpenSourceComponentId(),
    layer: args.layer,
    name: args.name.trim(),
    scope: args.scope?.trim() ?? '',
    license: args.license.trim(),
    sourceVisibility: args.sourceVisibility?.trim() ?? 'source_visible',
    commercialUse: args.commercialUse?.trim() ?? 'allowed',
    authorPolicy: args.authorPolicy?.trim() ?? '',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.openSourceComponents).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'open_source_governance.component.create',
    resourceType: 'open_source_component',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Open-source layer ${row.layer} registered.`,
    metadata: componentSnapshot(row),
  })
  return row
}

export async function listOpenSourceComponents(args: {
  layer?: SourceLicenseLayer
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<OpenSourceComponentRow[]> {
  const filters = [
    args.layer ? eq(schema.openSourceComponents.layer, args.layer) : undefined,
    args.status ? eq(schema.openSourceComponents.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.openSourceComponents.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.openSourceComponents.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function createCommunityGovernanceRole(
  args: CreateCommunityGovernanceRoleArgs,
): Promise<CommunityGovernanceRoleRow> {
  const now = Date.now()
  const row: CommunityGovernanceRoleRow = {
    id: newGovernanceRoleId(),
    roleType: args.roleType,
    name: args.name.trim(),
    responsibilities: args.responsibilities?.map((item) => item.trim()).filter(Boolean) ?? [],
    permissions: args.permissions?.map((item) => item.trim()).filter(Boolean) ?? [],
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.communityGovernanceRoles).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'open_source_governance.role.create',
    resourceType: 'community_governance_role',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Governance role ${row.roleType} registered.`,
    metadata: roleSnapshot(row),
  })
  return row
}

export async function listCommunityGovernanceRoles(args: {
  roleType?: GovernanceRoleType
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<CommunityGovernanceRoleRow[]> {
  const filters = [
    args.roleType ? eq(schema.communityGovernanceRoles.roleType, args.roleType) : undefined,
    args.status ? eq(schema.communityGovernanceRoles.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.communityGovernanceRoles.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.communityGovernanceRoles.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function createGovernanceRfc(
  args: CreateGovernanceRfcArgs,
): Promise<GovernanceRfcDecisionRow> {
  const now = Date.now()
  const row: GovernanceRfcDecisionRow = {
    id: newGovernanceRfcDecisionId(),
    title: args.title.trim(),
    summary: args.summary?.trim() ?? '',
    proposer: args.proposer?.trim() ?? '',
    status: 'rfc',
    discussionUrl: normalizeNullable(args.discussionUrl),
    votesFor: 0,
    votesAgainst: 0,
    implementationNotes: '',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.governanceRfcDecisions).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'open_source_governance.rfc.create',
    resourceType: 'governance_rfc_decision',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: row.title,
    metadata: rfcSnapshot(row),
  })
  return row
}

export async function advanceGovernanceRfc(
  id: string,
  args: AdvanceGovernanceRfcArgs,
): Promise<GovernanceRfcDecisionRow> {
  const row = await getRequiredRfc(id)
  const allowed = allowedNextStatuses(row.status)
  if (!allowed.includes(args.status) && args.status !== row.status) {
    throw new Error(`Cannot move RFC from ${row.status} to ${args.status}.`)
  }
  await db
    .update(schema.governanceRfcDecisions)
    .set({
      status: args.status,
      discussionUrl:
        args.discussionUrl === undefined ? row.discussionUrl : normalizeNullable(args.discussionUrl),
      votesFor: args.votesFor ?? row.votesFor,
      votesAgainst: args.votesAgainst ?? row.votesAgainst,
      implementationNotes: args.implementationNotes?.trim() ?? row.implementationNotes,
      updatedAt: Date.now(),
    })
    .where(eq(schema.governanceRfcDecisions.id, id))
  const updated = await getRequiredRfc(id)
  await recordAuditLog({
    actorType: 'system',
    action: 'open_source_governance.rfc.advance',
    resourceType: 'governance_rfc_decision',
    resourceId: updated.id,
    status: updated.status === 'rejected' ? 'blocked' : 'allowed',
    riskLevel: 'low',
    message: `${row.status} -> ${updated.status}`,
    metadata: rfcSnapshot(updated),
  })
  return updated
}

export async function listGovernanceRfcs(args: {
  status?: GovernanceRfcStatus
  proposer?: string
  limit?: number
} = {}): Promise<GovernanceRfcDecisionRow[]> {
  const filters = [
    args.status ? eq(schema.governanceRfcDecisions.status, args.status) : undefined,
    args.proposer ? eq(schema.governanceRfcDecisions.proposer, args.proposer) : undefined,
  ].filter(Boolean)
  return db.query.governanceRfcDecisions.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.governanceRfcDecisions.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function seedOpenSourceGovernance(): Promise<OpenSourceGovernanceSeed> {
  for (const component of defaultComponents) {
    const existing = await db.query.openSourceComponents.findFirst({
      where: eq(schema.openSourceComponents.layer, component.layer),
    })
    if (!existing) await createOpenSourceComponent(component)
  }
  for (const role of defaultRoles) {
    const existing = await db.query.communityGovernanceRoles.findFirst({
      where: eq(schema.communityGovernanceRoles.roleType, role.roleType),
    })
    if (!existing) await createCommunityGovernanceRole(role)
  }
  return {
    components: await listOpenSourceComponents({ limit: 100 }),
    roles: await listCommunityGovernanceRoles({ limit: 100 }),
  }
}

async function getRequiredRfc(id: string): Promise<GovernanceRfcDecisionRow> {
  const row = await db.query.governanceRfcDecisions.findFirst({
    where: eq(schema.governanceRfcDecisions.id, id),
  })
  if (!row) throw new Error(`Governance RFC not found: ${id}`)
  return row
}

function allowedNextStatuses(status: GovernanceRfcStatus): GovernanceRfcStatus[] {
  if (status === 'rfc') return ['discussion', 'rejected']
  if (status === 'discussion') return ['maintainer_vote', 'rejected']
  if (status === 'maintainer_vote') return ['implementation', 'accepted', 'rejected']
  if (status === 'implementation') return ['accepted', 'rejected']
  return []
}

function componentSnapshot(row: OpenSourceComponentRow): JsonObject {
  return {
    layer: row.layer,
    scope: row.scope,
    license: row.license,
    sourceVisibility: row.sourceVisibility,
    commercialUse: row.commercialUse,
  }
}

function roleSnapshot(row: CommunityGovernanceRoleRow): JsonObject {
  return {
    roleType: row.roleType,
    responsibilities: row.responsibilities,
    permissions: row.permissions,
  }
}

function rfcSnapshot(row: GovernanceRfcDecisionRow): JsonObject {
  return {
    title: row.title,
    status: row.status,
    proposer: row.proposer,
    discussionUrl: row.discussionUrl,
    votesFor: row.votesFor,
    votesAgainst: row.votesAgainst,
  }
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}
