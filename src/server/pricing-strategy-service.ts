import { and, asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  CommercialBillingPeriod,
  CommercialPlanKey,
  CommercialPlanRow,
  CommercialPlanStatus,
  CommercialPolicyRuleRow,
  CommercialPolicyRuleType,
  CommercialPolicySeverity,
  JsonObject,
  MonetizationRevenueStreamRow,
  RevenueStreamStatus,
  RevenueStreamType,
} from '@/db/schema'
import {
  newCommercialPlanId,
  newCommercialPolicyRuleId,
  newRevenueStreamId,
} from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateCommercialPlanArgs {
  planKey: CommercialPlanKey
  name: string
  priceCents?: number | null
  currency?: string
  billingPeriod: CommercialBillingPeriod
  maxAgents?: number | null
  maxConcurrentRuns?: number | null
  features?: string[]
  limits?: JsonObject
  status?: CommercialPlanStatus
}

export interface CreateRevenueStreamArgs {
  streamType: RevenueStreamType
  name: string
  priority?: number
  description?: string
  commissionRateBps?: number | null
  status?: RevenueStreamStatus
}

export interface CreateCommercialPolicyRuleArgs {
  ruleType: CommercialPolicyRuleType
  title: string
  description?: string
  severity?: CommercialPolicySeverity
  status?: CommercialPlanStatus
}

export interface CommercialStrategySeed {
  plans: CommercialPlanRow[]
  revenueStreams: MonetizationRevenueStreamRow[]
  policyRules: CommercialPolicyRuleRow[]
}

const defaultPlans: CreateCommercialPlanArgs[] = [
  {
    planKey: 'community',
    name: 'Community',
    priceCents: 0,
    billingPeriod: 'free',
    maxAgents: 3,
    maxConcurrentRuns: 2,
    features: ['local_models', 'community_skills'],
    limits: { localModelsOnly: true, communitySkillsOnly: true },
  },
  {
    planKey: 'professional',
    name: 'Professional',
    priceCents: 1900,
    billingPeriod: 'monthly',
    maxAgents: null,
    maxConcurrentRuns: 8,
    features: ['unlimited_agents', 'cloud_models', 'canvas', 'sdk'],
    limits: { cloudModels: true, sdk: true },
  },
  {
    planKey: 'team',
    name: 'Team',
    priceCents: 4900,
    billingPeriod: 'per_user_monthly',
    maxAgents: null,
    maxConcurrentRuns: null,
    features: ['multi_user_collaboration', 'agent_teams', 'shared_memory', 'enterprise_proxy', 'audit'],
    limits: { perUserBilling: true, sharedMemory: true, audit: true },
  },
  {
    planKey: 'enterprise',
    name: 'Enterprise',
    priceCents: null,
    billingPeriod: 'custom',
    maxAgents: null,
    maxConcurrentRuns: null,
    features: ['private_deployment', 'sso', 'advanced_compliance', 'dedicated_support', 'sla'],
    limits: { customContract: true, privateDeployment: true },
  },
]

const defaultRevenueStreams: CreateRevenueStreamArgs[] = [
  {
    streamType: 'subscription',
    name: 'Subscription fees',
    priority: 1,
    description: 'Primary recurring revenue through Professional, Team, and Enterprise plans.',
    status: 'active',
  },
  {
    streamType: 'enterprise_service',
    name: 'Enterprise services',
    priority: 2,
    description: 'Private deployment, onboarding, support, compliance, and SLA services.',
    status: 'active',
  },
  {
    streamType: 'marketplace_commission',
    name: 'Plugin and template marketplace commission',
    priority: 3,
    description: 'Marketplace revenue share for paid plugins, templates, Skills, and workflow packs.',
    commissionRateBps: 3000,
    status: 'future',
  },
  {
    streamType: 'compute_resale',
    name: 'Compute resource resale',
    priority: 4,
    description: 'Future cloud worker and model compute resale through explicit customer billing.',
    status: 'future',
  },
  {
    streamType: 'certification',
    name: 'Certification exam fees',
    priority: 5,
    description: 'Future training and certification program for Agent builders and operators.',
    status: 'future',
  },
]

const defaultPolicyRules: CreateCommercialPolicyRuleArgs[] = [
  {
    ruleType: 'forbidden_practice',
    title: 'Do not sell user data',
    description: 'User data is not a revenue stream and must not be sold.',
    severity: 'critical',
  },
  {
    ruleType: 'forbidden_practice',
    title: 'Do not secretly train on user data',
    description: 'Customer data must not be used for model training without explicit policy and consent.',
    severity: 'critical',
  },
  {
    ruleType: 'forbidden_practice',
    title: 'Do not monetize with ads',
    description: 'The product strategy excludes advertising as a monetization model.',
    severity: 'warning',
  },
]

export async function createCommercialPlan(
  args: CreateCommercialPlanArgs,
): Promise<CommercialPlanRow> {
  const now = Date.now()
  const row: CommercialPlanRow = {
    id: newCommercialPlanId(),
    planKey: args.planKey,
    name: args.name.trim(),
    priceCents: args.priceCents ?? null,
    currency: args.currency?.trim().toUpperCase() || 'USD',
    billingPeriod: args.billingPeriod,
    maxAgents: args.maxAgents ?? null,
    maxConcurrentRuns: args.maxConcurrentRuns ?? null,
    features: args.features?.map((feature) => feature.trim()).filter(Boolean) ?? [],
    limits: args.limits ?? {},
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.commercialPlans).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'commercial.plan.create',
    resourceType: 'commercial_plan',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Commercial plan ${row.name} created.`,
    metadata: commercialPlanSnapshot(row),
  })
  return row
}

export async function listCommercialPlans(args: {
  planKey?: CommercialPlanKey
  status?: CommercialPlanStatus
  limit?: number
} = {}): Promise<CommercialPlanRow[]> {
  const filters = [
    args.planKey ? eq(schema.commercialPlans.planKey, args.planKey) : undefined,
    args.status ? eq(schema.commercialPlans.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.commercialPlans.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [asc(schema.commercialPlans.priceCents), asc(schema.commercialPlans.planKey)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function createRevenueStream(
  args: CreateRevenueStreamArgs,
): Promise<MonetizationRevenueStreamRow> {
  const now = Date.now()
  const row: MonetizationRevenueStreamRow = {
    id: newRevenueStreamId(),
    streamType: args.streamType,
    name: args.name.trim(),
    priority: args.priority ?? 100,
    description: args.description?.trim() ?? '',
    commissionRateBps: args.commissionRateBps ?? null,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.monetizationRevenueStreams).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'commercial.revenue_stream.create',
    resourceType: 'monetization_revenue_stream',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: 'low',
    message: `Revenue stream ${row.name} created.`,
    metadata: revenueStreamSnapshot(row),
  })
  return row
}

export async function listRevenueStreams(args: {
  streamType?: RevenueStreamType
  status?: RevenueStreamStatus
  limit?: number
} = {}): Promise<MonetizationRevenueStreamRow[]> {
  const filters = [
    args.streamType ? eq(schema.monetizationRevenueStreams.streamType, args.streamType) : undefined,
    args.status ? eq(schema.monetizationRevenueStreams.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.monetizationRevenueStreams.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [asc(schema.monetizationRevenueStreams.priority), desc(schema.monetizationRevenueStreams.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function createCommercialPolicyRule(
  args: CreateCommercialPolicyRuleArgs,
): Promise<CommercialPolicyRuleRow> {
  const now = Date.now()
  const row: CommercialPolicyRuleRow = {
    id: newCommercialPolicyRuleId(),
    ruleType: args.ruleType,
    title: args.title.trim(),
    description: args.description?.trim() ?? '',
    severity: args.severity ?? 'info',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.commercialPolicyRules).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'commercial.policy_rule.create',
    resourceType: 'commercial_policy_rule',
    resourceId: row.id,
    status: row.ruleType === 'forbidden_practice' ? 'blocked' : 'allowed',
    riskLevel: row.severity === 'critical' ? 'high' : row.severity === 'warning' ? 'medium' : 'low',
    message: row.title,
    metadata: policyRuleSnapshot(row),
  })
  return row
}

export async function listCommercialPolicyRules(args: {
  ruleType?: CommercialPolicyRuleType
  status?: CommercialPlanStatus
  limit?: number
} = {}): Promise<CommercialPolicyRuleRow[]> {
  const filters = [
    args.ruleType ? eq(schema.commercialPolicyRules.ruleType, args.ruleType) : undefined,
    args.status ? eq(schema.commercialPolicyRules.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.commercialPolicyRules.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.commercialPolicyRules.severity), desc(schema.commercialPolicyRules.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

export async function seedCommercialStrategy(): Promise<CommercialStrategySeed> {
  for (const plan of defaultPlans) {
    const existing = await db.query.commercialPlans.findFirst({
      where: eq(schema.commercialPlans.planKey, plan.planKey),
    })
    if (!existing) await createCommercialPlan(plan)
  }
  for (const stream of defaultRevenueStreams) {
    const existing = await db.query.monetizationRevenueStreams.findFirst({
      where: eq(schema.monetizationRevenueStreams.streamType, stream.streamType),
    })
    if (!existing) await createRevenueStream(stream)
  }
  for (const rule of defaultPolicyRules) {
    const existing = await db.query.commercialPolicyRules.findFirst({
      where: and(
        eq(schema.commercialPolicyRules.ruleType, rule.ruleType),
        eq(schema.commercialPolicyRules.title, rule.title),
      ),
    })
    if (!existing) await createCommercialPolicyRule(rule)
  }
  return {
    plans: await listCommercialPlans({ limit: 100 }),
    revenueStreams: await listRevenueStreams({ limit: 100 }),
    policyRules: await listCommercialPolicyRules({ limit: 100 }),
  }
}

function commercialPlanSnapshot(row: CommercialPlanRow): JsonObject {
  return {
    planKey: row.planKey,
    priceCents: row.priceCents,
    billingPeriod: row.billingPeriod,
    maxAgents: row.maxAgents,
    maxConcurrentRuns: row.maxConcurrentRuns,
    features: row.features,
    limits: row.limits,
  }
}

function revenueStreamSnapshot(row: MonetizationRevenueStreamRow): JsonObject {
  return {
    streamType: row.streamType,
    priority: row.priority,
    commissionRateBps: row.commissionRateBps,
    status: row.status,
  }
}

function policyRuleSnapshot(row: CommercialPolicyRuleRow): JsonObject {
  return {
    ruleType: row.ruleType,
    severity: row.severity,
    status: row.status,
  }
}
