import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ContributionPolicyRow,
  ContributionPolicyType,
  ContributorPrerequisiteRow,
  ContributorTool,
  JsonObject,
  OpenSourceGovernanceStatus,
} from '@/db/schema'
import {
  newContributionPolicyId,
  newContributorPrerequisiteId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateContributorPrerequisiteArgs {
  tool: ContributorTool
  minimumVersion?: string
  required?: boolean
  installHint?: string
  status?: OpenSourceGovernanceStatus
}

export interface CreateContributionPolicyArgs {
  policyType: ContributionPolicyType
  key: string
  description?: string
  required?: boolean
  metadata?: JsonObject
  status?: OpenSourceGovernanceStatus
}

export interface ContributorEnvironmentInput {
  nodeVersion?: string
  rustVersion?: string
  pythonVersion?: string
  hasGit?: boolean
  hasChrome?: boolean
}

export interface ContributorEnvironmentCheck {
  tool: ContributorTool
  required: boolean
  minimumVersion: string
  observed: string | boolean | null
  status: 'ok' | 'missing' | 'outdated'
}

export interface ContributorGuideSeed {
  prerequisites: ContributorPrerequisiteRow[]
  policies: ContributionPolicyRow[]
}

const defaultPrerequisites: CreateContributorPrerequisiteArgs[] = [
  { tool: 'node', minimumVersion: '20.0.0', installHint: 'Install Node.js 20 or newer.' },
  { tool: 'rust', minimumVersion: '1.75.0', installHint: 'Install Rust 1.75 or newer.' },
  { tool: 'python', minimumVersion: '3.11.0', installHint: 'Install Python 3.11 or newer.' },
  { tool: 'git', installHint: 'Install Git and configure a user identity.' },
  { tool: 'chrome', installHint: 'Install Chrome for browser automation and UI smoke tests.' },
]

const defaultPolicies: CreateContributionPolicyArgs[] = [
  {
    policyType: 'getting_started',
    key: 'startup',
    description: 'Clone the repository, install dependencies, and start the dev server.',
    metadata: { steps: ['git clone', 'pnpm install', 'pnpm dev'] },
  },
  {
    policyType: 'project_structure',
    key: 'monorepo',
    description: 'Monorepo layout for apps, packages, tests, and docs.',
    metadata: {
      paths: [
        'apps/desktop',
        'apps/cli',
        'packages/core',
        'services',
        'canvas',
        'memory',
        'browser',
        'desktop-op',
        'sdk',
        'shared',
        'tests/unit',
        'tests/integration',
        'tests/e2e',
        'docs/',
      ],
    },
  },
  {
    policyType: 'commit_convention',
    key: 'conventional-types',
    description: 'Allowed commit prefixes.',
    metadata: {
      types: ['feat', 'fix', 'security', 'perf', 'refactor', 'test', 'docs', 'chore'],
    },
  },
  {
    policyType: 'branch_rule',
    key: 'branch-model',
    description: 'Stable main, development branch, and feature/fix branches.',
    metadata: {
      main: 'stable',
      develop: 'development',
      patterns: ['feat/*', 'fix/*'],
    },
  },
  {
    policyType: 'review_rule',
    key: 'review-gate',
    description: 'Review requires a maintainer, passing CI, non-decreasing coverage, and extra security review.',
    metadata: {
      minMaintainers: 1,
      ciRequired: true,
      coverageMustNotDecrease: true,
      securityChangesNeedExtraReview: true,
    },
  },
]

export async function createContributorPrerequisite(
  args: CreateContributorPrerequisiteArgs,
): Promise<ContributorPrerequisiteRow> {
  const now = Date.now()
  const row: ContributorPrerequisiteRow = {
    id: newContributorPrerequisiteId(),
    tool: args.tool,
    minimumVersion: args.minimumVersion?.trim() ?? '',
    required: args.required ?? true,
    installHint: args.installHint?.trim() ?? '',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.contributorPrerequisites).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'contributor_guide.prerequisite.create',
    resourceType: 'contributor_prerequisite',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `${row.tool} prerequisite registered.`,
    metadata: prerequisiteSnapshot(row),
  })
  return row
}

export async function listContributorPrerequisites(args: {
  tool?: ContributorTool
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<ContributorPrerequisiteRow[]> {
  const filters = [
    args.tool ? eq(schema.contributorPrerequisites.tool, args.tool) : undefined,
    args.status ? eq(schema.contributorPrerequisites.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.contributorPrerequisites.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.contributorPrerequisites.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function createContributionPolicy(
  args: CreateContributionPolicyArgs,
): Promise<ContributionPolicyRow> {
  const now = Date.now()
  const row: ContributionPolicyRow = {
    id: newContributionPolicyId(),
    policyType: args.policyType,
    key: args.key.trim(),
    description: args.description?.trim() ?? '',
    required: args.required ?? true,
    metadata: args.metadata ?? {},
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.contributionPolicies).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'contributor_guide.policy.create',
    resourceType: 'contribution_policy',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `${row.policyType}:${row.key} policy registered.`,
    metadata: policySnapshot(row),
  })
  return row
}

export async function listContributionPolicies(args: {
  policyType?: ContributionPolicyType
  status?: OpenSourceGovernanceStatus
  limit?: number
} = {}): Promise<ContributionPolicyRow[]> {
  const filters = [
    args.policyType ? eq(schema.contributionPolicies.policyType, args.policyType) : undefined,
    args.status ? eq(schema.contributionPolicies.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.contributionPolicies.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.contributionPolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function seedContributorGuide(): Promise<ContributorGuideSeed> {
  for (const prereq of defaultPrerequisites) {
    const existing = await db.query.contributorPrerequisites.findFirst({
      where: eq(schema.contributorPrerequisites.tool, prereq.tool),
    })
    if (!existing) await createContributorPrerequisite(prereq)
  }
  for (const policy of defaultPolicies) {
    const existing = await db.query.contributionPolicies.findFirst({
      where: and(
        eq(schema.contributionPolicies.policyType, policy.policyType),
        eq(schema.contributionPolicies.key, policy.key),
      ),
    })
    if (!existing) await createContributionPolicy(policy)
  }
  return {
    prerequisites: await listContributorPrerequisites({ limit: 100 }),
    policies: await listContributionPolicies({ limit: 100 }),
  }
}

export async function evaluateContributorEnvironment(
  input: ContributorEnvironmentInput,
): Promise<ContributorEnvironmentCheck[]> {
  const prereqs = await listContributorPrerequisites({ status: 'active', limit: 100 })
  return prereqs.map((prereq) => {
    const observed = observedValue(prereq.tool, input)
    const status =
      observed === null || observed === false
        ? 'missing'
        : typeof observed === 'string' && prereq.minimumVersion && compareVersions(observed, prereq.minimumVersion) < 0
          ? 'outdated'
          : 'ok'
    return {
      tool: prereq.tool,
      required: prereq.required,
      minimumVersion: prereq.minimumVersion,
      observed,
      status,
    }
  })
}

function observedValue(
  tool: ContributorTool,
  input: ContributorEnvironmentInput,
): string | boolean | null {
  if (tool === 'node') return input.nodeVersion ?? null
  if (tool === 'rust') return input.rustVersion ?? null
  if (tool === 'python') return input.pythonVersion ?? null
  if (tool === 'git') return input.hasGit ?? false
  return input.hasChrome ?? false
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function parseVersion(value: string): number[] {
  return value
    .replace(/^[^\d]*/, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((part) => Number(part))
}

function prerequisiteSnapshot(row: ContributorPrerequisiteRow): JsonObject {
  return {
    tool: row.tool,
    minimumVersion: row.minimumVersion,
    required: row.required,
  }
}

function policySnapshot(row: ContributionPolicyRow): JsonObject {
  return {
    policyType: row.policyType,
    key: row.key,
    required: row.required,
    metadata: row.metadata,
  }
}
