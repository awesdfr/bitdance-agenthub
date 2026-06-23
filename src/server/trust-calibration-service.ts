import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AutonomyLevel,
  JsonObject,
  TrustCalibrationConfig,
  TrustCalibrationEvaluationRow,
  TrustCalibrationMetrics,
  TrustCalibrationPolicyRow,
  TrustCalibrationPolicyStatus,
  TrustCalibrationRecommendation,
  TrustLevel,
} from '@/db/schema'
import {
  newTrustCalibrationEvaluationId,
  newTrustCalibrationPolicyId,
} from '@/server/ids'

const DEFAULT_CONFIG: TrustCalibrationConfig = {
  highConfidenceIndicators: {
    showConfidenceBadge: true,
    showEvidence: true,
    showVerifiedCheck: true,
  },
  lowConfidenceIndicators: {
    showWarningBadge: true,
    showUncertaintyReason: true,
    suggestHumanReview: true,
  },
  antiOverTrust: {
    streakWarning: 8,
    periodicRealityCheck: true,
  },
}

const TRUST_PATH: JsonObject[] = [
  {
    day: 1,
    trustLevel: 'day_1_untrusted',
    defaultAutonomyLevel: 'propose_only',
    policy: 'All meaningful actions require approval.',
  },
  {
    day: 3,
    trustLevel: 'low',
    defaultAutonomyLevel: 'execute_with_approval',
    policy: 'Read-only work may be automatic; writes still need approval.',
  },
  {
    day: 7,
    trustLevel: 'medium',
    defaultAutonomyLevel: 'execute_low_risk',
    policy: 'Low-risk actions can run automatically; high-risk actions require approval.',
  },
  {
    day: 30,
    trustLevel: 'high',
    defaultAutonomyLevel: 'fully_autonomous',
    policy: 'Most actions can run automatically with periodic reality checks.',
  },
]

const AUTONOMY_RANK: Record<AutonomyLevel, number> = {
  observe_only: 0,
  propose_only: 1,
  execute_with_approval: 2,
  execute_low_risk: 3,
  fully_autonomous: 4,
}

export interface TrustCalibrationPolicyArgs {
  agentProfileId?: string | null
  name?: string
  config?: TrustCalibrationConfigInput
  status?: TrustCalibrationPolicyStatus
}

export interface TrustCalibrationConfigInput {
  highConfidenceIndicators?: Partial<TrustCalibrationConfig['highConfidenceIndicators']>
  lowConfidenceIndicators?: Partial<TrustCalibrationConfig['lowConfidenceIndicators']>
  antiOverTrust?: Partial<TrustCalibrationConfig['antiOverTrust']>
}

export interface TrustCalibrationEvaluationArgs {
  policyId?: string | null
  agentProfileId?: string | null
  currentAutonomyLevel?: AutonomyLevel
  metrics?: Partial<TrustCalibrationMetrics>
}

export async function seedTrustCalibrationPolicies(): Promise<TrustCalibrationPolicyRow[]> {
  const existing = await db.query.trustCalibrationPolicies.findFirst({
    where: eq(schema.trustCalibrationPolicies.name, 'Default trust calibration policy'),
  })
  if (existing) return [existing]
  return [await createTrustCalibrationPolicy({
    name: 'Default trust calibration policy',
    config: DEFAULT_CONFIG,
    status: 'active',
  })]
}

export async function createTrustCalibrationPolicy(
  args: TrustCalibrationPolicyArgs,
): Promise<TrustCalibrationPolicyRow> {
  const now = Date.now()
  const row = {
    id: newTrustCalibrationPolicyId(),
    agentProfileId: normalizeNullable(args.agentProfileId),
    name: args.name?.trim() || 'Trust calibration policy',
    config: mergeConfig(args.config),
    trustPath: TRUST_PATH,
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  } satisfies TrustCalibrationPolicyRow
  await db.insert(schema.trustCalibrationPolicies).values(row)
  return row
}

export async function listTrustCalibrationPolicies(args: {
  agentProfileId?: string
  status?: TrustCalibrationPolicyStatus
  limit?: number
} = {}): Promise<TrustCalibrationPolicyRow[]> {
  const conditions: SQL[] = []
  if (args.agentProfileId) conditions.push(eq(schema.trustCalibrationPolicies.agentProfileId, args.agentProfileId))
  if (args.status) conditions.push(eq(schema.trustCalibrationPolicies.status, args.status))
  return db.query.trustCalibrationPolicies.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.trustCalibrationPolicies.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function evaluateTrustCalibration(
  args: TrustCalibrationEvaluationArgs,
): Promise<TrustCalibrationEvaluationRow> {
  const policy = await resolvePolicy(args.policyId, args.agentProfileId)
  const metrics = await resolveMetrics(args)
  const currentAutonomyLevel = args.currentAutonomyLevel ?? 'execute_with_approval'
  const recommendedTrustLevel = trustLevelForMetrics(metrics)
  const currentTrustLevel = trustLevelForAutonomy(currentAutonomyLevel)
  const recommendedAutonomyLevel = autonomyForTrustLevel(recommendedTrustLevel)
  const signals = buildSignals(policy.config, metrics, recommendedTrustLevel)
  const reasons = buildReasons(metrics, recommendedTrustLevel, recommendedAutonomyLevel)
  const recommendation = recommendationFor({
    currentAutonomyLevel,
    recommendedAutonomyLevel,
    metrics,
    policyConfig: policy.config,
  })
  const row = {
    id: newTrustCalibrationEvaluationId(),
    policyId: policy.id,
    agentProfileId: normalizeNullable(args.agentProfileId ?? policy.agentProfileId),
    metrics,
    currentTrustLevel,
    recommendedTrustLevel,
    currentAutonomyLevel,
    recommendedAutonomyLevel,
    recommendation,
    signals,
    reasons,
    createdAt: Date.now(),
  }
  await db.insert(schema.trustCalibrationEvaluations).values(row)
  return row
}

export async function listTrustCalibrationEvaluations(args: {
  policyId?: string
  agentProfileId?: string
  recommendation?: TrustCalibrationRecommendation
  limit?: number
} = {}): Promise<TrustCalibrationEvaluationRow[]> {
  const conditions: SQL[] = []
  if (args.policyId) conditions.push(eq(schema.trustCalibrationEvaluations.policyId, args.policyId))
  if (args.agentProfileId) conditions.push(eq(schema.trustCalibrationEvaluations.agentProfileId, args.agentProfileId))
  if (args.recommendation) conditions.push(eq(schema.trustCalibrationEvaluations.recommendation, args.recommendation))
  return db.query.trustCalibrationEvaluations.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.trustCalibrationEvaluations.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function resolvePolicy(
  policyId?: string | null,
  agentProfileId?: string | null,
): Promise<TrustCalibrationPolicyRow> {
  const id = normalizeNullable(policyId)
  if (id) {
    const policy = await db.query.trustCalibrationPolicies.findFirst({
      where: eq(schema.trustCalibrationPolicies.id, id),
    })
    if (!policy) throw new Error(`Trust calibration policy not found: ${id}`)
    return policy
  }
  const agentId = normalizeNullable(agentProfileId)
  if (agentId) {
    const agentPolicy = await db.query.trustCalibrationPolicies.findFirst({
      where: and(
        eq(schema.trustCalibrationPolicies.agentProfileId, agentId),
        eq(schema.trustCalibrationPolicies.status, 'active'),
      ),
      orderBy: [desc(schema.trustCalibrationPolicies.updatedAt)],
    })
    if (agentPolicy) return agentPolicy
  }
  const existing = await db.query.trustCalibrationPolicies.findFirst({
    where: eq(schema.trustCalibrationPolicies.status, 'active'),
    orderBy: [desc(schema.trustCalibrationPolicies.updatedAt)],
  })
  if (existing) return existing
  const [seeded] = await seedTrustCalibrationPolicies()
  return seeded
}

async function resolveMetrics(
  args: TrustCalibrationEvaluationArgs,
): Promise<TrustCalibrationMetrics> {
  const base = await deriveMetricsFromAgent(args.agentProfileId)
  return {
    daysActive: args.metrics?.daysActive ?? base.daysActive,
    runCount: args.metrics?.runCount ?? base.runCount,
    successRate: clamp(args.metrics?.successRate ?? base.successRate),
    approvalsApproved: args.metrics?.approvalsApproved ?? base.approvalsApproved,
    approvalsRejected: args.metrics?.approvalsRejected ?? base.approvalsRejected,
    takeoverCount: args.metrics?.takeoverCount ?? base.takeoverCount,
    modificationRate: clamp(args.metrics?.modificationRate ?? base.modificationRate),
    similarTaskCount: args.metrics?.similarTaskCount ?? base.similarTaskCount,
    verifiedArtifactCount: args.metrics?.verifiedArtifactCount ?? base.verifiedArtifactCount,
    highConfidenceSuccessStreak:
      args.metrics?.highConfidenceSuccessStreak ?? base.highConfidenceSuccessStreak,
  }
}

async function deriveMetricsFromAgent(
  agentProfileId?: string | null,
): Promise<TrustCalibrationMetrics> {
  const agentId = normalizeNullable(agentProfileId)
  if (!agentId) return emptyMetrics()
  const [agent, runs, approvals] = await Promise.all([
    db.query.agentProfiles.findFirst({
      where: eq(schema.agentProfiles.id, agentId),
    }),
    db.query.employeeRuns.findMany({
      where: eq(schema.employeeRuns.agentProfileId, agentId),
      orderBy: [desc(schema.employeeRuns.createdAt)],
      limit: 200,
    }),
    db.query.approvalRequests.findMany({
      where: eq(schema.approvalRequests.agentProfileId, agentId),
      orderBy: [desc(schema.approvalRequests.createdAt)],
      limit: 200,
    }),
  ])
  const closedRuns = runs.filter((run) => ['complete', 'failed', 'aborted'].includes(run.status))
  const completedRuns = closedRuns.filter((run) => run.status === 'complete')
  const approved = approvals.filter((approval) => approval.status === 'approved').length
  const rejected = approvals.filter((approval) => approval.status === 'rejected').length
  return {
    daysActive: agent ? Math.max(1, Math.ceil((Date.now() - agent.createdAt) / 86400000)) : 1,
    runCount: runs.length,
    successRate: closedRuns.length ? completedRuns.length / closedRuns.length : 0,
    approvalsApproved: approved,
    approvalsRejected: rejected,
    takeoverCount: 0,
    modificationRate: 0,
    similarTaskCount: completedRuns.length,
    verifiedArtifactCount: completedRuns.filter((run) => Boolean(run.output)).length,
    highConfidenceSuccessStreak: trailingCompleteStreak(runs),
  }
}

function emptyMetrics(): TrustCalibrationMetrics {
  return {
    daysActive: 1,
    runCount: 0,
    successRate: 0,
    approvalsApproved: 0,
    approvalsRejected: 0,
    takeoverCount: 0,
    modificationRate: 0,
    similarTaskCount: 0,
    verifiedArtifactCount: 0,
    highConfidenceSuccessStreak: 0,
  }
}

function trustLevelForMetrics(metrics: TrustCalibrationMetrics): TrustLevel {
  const approvalTotal = metrics.approvalsApproved + metrics.approvalsRejected
  const approvalRate = approvalTotal ? metrics.approvalsApproved / approvalTotal : 1
  if (metrics.daysActive < 3 || metrics.runCount < 1) return 'day_1_untrusted'
  if (metrics.daysActive < 7 || metrics.successRate < 0.65 || approvalRate < 0.6) return 'low'
  if (
    metrics.daysActive < 30 ||
    metrics.successRate < 0.85 ||
    approvalRate < 0.8 ||
    metrics.takeoverCount > 2 ||
    metrics.modificationRate > 0.2
  ) {
    return 'medium'
  }
  return 'high'
}

function trustLevelForAutonomy(level: AutonomyLevel): TrustLevel {
  if (level === 'observe_only' || level === 'propose_only') return 'day_1_untrusted'
  if (level === 'execute_with_approval') return 'low'
  if (level === 'execute_low_risk') return 'medium'
  return 'high'
}

function autonomyForTrustLevel(level: TrustLevel): AutonomyLevel {
  if (level === 'day_1_untrusted') return 'propose_only'
  if (level === 'low') return 'execute_with_approval'
  if (level === 'medium') return 'execute_low_risk'
  return 'fully_autonomous'
}

function recommendationFor(args: {
  currentAutonomyLevel: AutonomyLevel
  recommendedAutonomyLevel: AutonomyLevel
  metrics: TrustCalibrationMetrics
  policyConfig: TrustCalibrationConfig
}): TrustCalibrationRecommendation {
  if (
    args.policyConfig.antiOverTrust.periodicRealityCheck &&
    args.metrics.highConfidenceSuccessStreak >= args.policyConfig.antiOverTrust.streakWarning
  ) {
    return 'require_manual_review'
  }
  const current = AUTONOMY_RANK[args.currentAutonomyLevel]
  const recommended = AUTONOMY_RANK[args.recommendedAutonomyLevel]
  if (recommended > current) return 'increase_autonomy'
  if (recommended < current) return 'decrease_autonomy'
  return 'keep_current'
}

function buildSignals(
  config: TrustCalibrationConfig,
  metrics: TrustCalibrationMetrics,
  trustLevel: TrustLevel,
): JsonObject[] {
  const signals: JsonObject[] = []
  if (trustLevel === 'high' && config.highConfidenceIndicators.showConfidenceBadge) {
    signals.push({ kind: 'high_confidence_badge', label: 'High confidence', trustLevel })
  }
  if (trustLevel === 'high' && config.highConfidenceIndicators.showEvidence) {
    signals.push({
      kind: 'evidence',
      label: `Based on ${metrics.similarTaskCount} similar tasks and ${metrics.verifiedArtifactCount} verified artifacts.`,
      trustLevel,
    })
  }
  if (metrics.verifiedArtifactCount > 0 && config.highConfidenceIndicators.showVerifiedCheck) {
    signals.push({ kind: 'verified_check', label: 'Recent output was verified.', trustLevel })
  }
  if ((trustLevel === 'day_1_untrusted' || trustLevel === 'low') && config.lowConfidenceIndicators.showWarningBadge) {
    signals.push({ kind: 'warning_badge', label: 'Human review recommended.', trustLevel })
  }
  if ((trustLevel === 'day_1_untrusted' || trustLevel === 'low') && config.lowConfidenceIndicators.showUncertaintyReason) {
    signals.push({ kind: 'uncertainty_reason', label: 'Not enough successful history yet.', trustLevel })
  }
  if ((trustLevel === 'day_1_untrusted' || trustLevel === 'low') && config.lowConfidenceIndicators.suggestHumanReview) {
    signals.push({ kind: 'human_review_suggestion', label: 'Check high-risk steps before increasing autonomy.', trustLevel })
  }
  if (metrics.highConfidenceSuccessStreak >= config.antiOverTrust.streakWarning) {
    signals.push({
      kind: 'anti_overtrust_reality_check',
      label: 'Long success streak reached; keep periodic review active.',
      trustLevel,
    })
  }
  return signals
}

function buildReasons(
  metrics: TrustCalibrationMetrics,
  trustLevel: TrustLevel,
  autonomyLevel: AutonomyLevel,
): string[] {
  const approvalTotal = metrics.approvalsApproved + metrics.approvalsRejected
  const approvalRate = approvalTotal ? metrics.approvalsApproved / approvalTotal : 1
  return [
    `Trust level ${trustLevel} maps to autonomy level ${autonomyLevel}.`,
    `Success rate is ${round(metrics.successRate * 100)}% across ${metrics.runCount} runs.`,
    `Approval pass rate is ${round(approvalRate * 100)}% across ${approvalTotal} decisions.`,
    `Takeovers=${metrics.takeoverCount}, modificationRate=${round(metrics.modificationRate * 100)}%.`,
  ]
}

function mergeConfig(config?: TrustCalibrationConfigInput): TrustCalibrationConfig {
  return {
    highConfidenceIndicators: {
      ...DEFAULT_CONFIG.highConfidenceIndicators,
      ...config?.highConfidenceIndicators,
    },
    lowConfidenceIndicators: {
      ...DEFAULT_CONFIG.lowConfidenceIndicators,
      ...config?.lowConfidenceIndicators,
    },
    antiOverTrust: {
      ...DEFAULT_CONFIG.antiOverTrust,
      ...config?.antiOverTrust,
    },
  }
}

function trailingCompleteStreak(runs: Array<{ status: string }>): number {
  let streak = 0
  for (const run of runs) {
    if (run.status !== 'complete') break
    streak += 1
  }
  return streak
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
