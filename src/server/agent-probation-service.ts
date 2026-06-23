import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentDeploymentEnvironment,
  AgentEnvironmentPromotionRow,
  AgentProbationRecordRow,
  AgentProbationStatus,
  AgentRiskTier,
  JsonObject,
} from '@/db/schema'
import {
  newAgentEnvironmentPromotionId,
  newAgentProbationRecordId,
  newApprovalRequestId,
} from '@/server/ids'

export interface EnsureAgentProbationArgs {
  agentProfileId: string
  environment?: AgentDeploymentEnvironment
  promotionTaskThreshold?: number
  promotionSuccessRateThreshold?: number
}

export interface EvaluateAgentProbationArgs {
  agentProfileId: string
  autoGraduate?: boolean
}

export interface RequestAgentPromotionArgs {
  agentProfileId: string
  productionAgentProfileId?: string
  abComparison?: JsonObject
  note?: string
}

export interface DecideAgentPromotionArgs {
  decision: 'approved' | 'rejected'
  note?: string
}

interface RunSummary extends JsonObject {
  agentProfileId: string
  taskCount: number
  successCount: number
  successRate: number
  averageCostCents: number
  averagePlannedSteps: number
}

const probationRestrictions: JsonObject = {
  autonomyLevel: 'propose_only',
  allowedAutonomyLevels: ['observe_only', 'propose_only'],
  canDeleteFiles: false,
  canSendExternalNetworkRequests: false,
  writeOperationsRequireApproval: true,
  tokenBudgetMultiplier: 0.5,
  maxConcurrentStepMultiplier: 0.5,
  stagingSandboxRequired: true,
  outputDeployable: false,
}

export async function ensureAgentProbationRecord(
  args: EnsureAgentProbationArgs,
): Promise<AgentProbationRecordRow> {
  await getRequiredAgentProfile(args.agentProfileId)
  const existing = await db.query.agentProbationRecords.findFirst({
    where: eq(schema.agentProbationRecords.agentProfileId, args.agentProfileId),
    orderBy: [desc(schema.agentProbationRecords.createdAt)],
  })
  if (existing) return existing

  const now = Date.now()
  const row = {
    id: newAgentProbationRecordId(),
    agentProfileId: args.agentProfileId,
    environment: args.environment ?? 'staging',
    status: 'probation' as const,
    riskTier: 'high' as const,
    taskCount: 0,
    successCount: 0,
    successRate: 0,
    promotionTaskThreshold: args.promotionTaskThreshold ?? 10,
    promotionSuccessRateThreshold: args.promotionSuccessRateThreshold ?? 0.8,
    restrictions: probationRestrictions,
    evaluation: {
      reason: 'New Agent starts in probation by default.',
      probationRestrictionsActive: true,
    },
    createdAt: now,
    updatedAt: now,
    graduatedAt: null,
  }
  await db.insert(schema.agentProbationRecords).values(row)
  return row
}

export async function evaluateAgentProbation(
  args: EvaluateAgentProbationArgs,
): Promise<AgentProbationRecordRow> {
  const record = await ensureAgentProbationRecord({ agentProfileId: args.agentProfileId })
  const runs = await db.query.employeeRuns.findMany({
    where: eq(schema.employeeRuns.agentProfileId, args.agentProfileId),
    orderBy: [desc(schema.employeeRuns.createdAt)],
    limit: 500,
  })
  const terminalRuns = runs.filter((run) => ['complete', 'failed', 'aborted'].includes(run.status))
  const taskCount = terminalRuns.length
  const successCount = terminalRuns.filter((run) => run.status === 'complete').length
  const successRate = taskCount > 0 ? successCount / taskCount : 0
  const eligible =
    taskCount >= record.promotionTaskThreshold &&
    successRate > record.promotionSuccessRateThreshold
  const status = nextProbationStatus(record.status, eligible, args.autoGraduate === true)
  const now = Date.now()
  const graduatedAt = status === 'graduated' ? record.graduatedAt ?? now : record.graduatedAt
  const riskTier = classifyRiskTier({
    status,
    environment: record.environment,
    taskCount,
    successRate,
  })
  const restrictions =
    status === 'graduated'
      ? {
          probationRestrictionsActive: false,
          normalAutonomyPolicyRestored: true,
          productionPromotionStillRequiresApproval: record.environment !== 'production',
        }
      : probationRestrictions
  const evaluation: JsonObject = {
    taskCount,
    successCount,
    successRate,
    requiredTaskCount: record.promotionTaskThreshold,
    requiredSuccessRate: record.promotionSuccessRateThreshold,
    eligibleForGraduation: eligible,
    autoGraduate: args.autoGraduate === true,
    probationRestrictionsActive: status !== 'graduated',
    environment: record.environment,
    riskTier,
  }

  await db
    .update(schema.agentProbationRecords)
    .set({
      status,
      riskTier,
      taskCount,
      successCount,
      successRate,
      restrictions,
      evaluation,
      graduatedAt,
      updatedAt: now,
    })
    .where(eq(schema.agentProbationRecords.id, record.id))
  return getRequiredProbationRecord(record.id)
}

export async function listAgentProbationRecords(args: {
  agentProfileId?: string
  status?: AgentProbationStatus
  environment?: AgentDeploymentEnvironment
  limit?: number
} = {}): Promise<AgentProbationRecordRow[]> {
  const rows = await db.query.agentProbationRecords.findMany({
    orderBy: [desc(schema.agentProbationRecords.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
  return rows.filter((row) =>
    (!args.agentProfileId || row.agentProfileId === args.agentProfileId) &&
    (!args.status || row.status === args.status) &&
    (!args.environment || row.environment === args.environment),
  )
}

export async function requestAgentProductionPromotion(
  args: RequestAgentPromotionArgs,
): Promise<AgentEnvironmentPromotionRow> {
  const record = await evaluateAgentProbation({
    agentProfileId: args.agentProfileId,
    autoGraduate: false,
  })
  if (record.environment === 'production') {
    throw new Error(`Agent is already production: ${args.agentProfileId}`)
  }
  if (!['eligible_for_promotion', 'graduated'].includes(record.status)) {
    throw new Error(`Agent is still in probation and cannot request production promotion: ${args.agentProfileId}`)
  }

  const now = Date.now()
  const abComparison = args.abComparison ?? await buildAbComparison({
    stagingAgentProfileId: args.agentProfileId,
    productionAgentProfileId: args.productionAgentProfileId,
  })
  const approvalRequest = {
    id: newApprovalRequestId(),
    conversationId: null,
    runId: null,
    nodeRunId: null,
    agentProfileId: args.agentProfileId,
    type: 'agent_environment_promotion',
    status: 'pending' as const,
    title: 'Promote Agent from staging to production',
    description: args.note ?? 'Production promotion requires explicit user approval.',
    riskLevel: record.riskTier === 'low' ? 'medium' as const : 'high' as const,
    payload: {
      agentProfileId: args.agentProfileId,
      probationRecordId: record.id,
      fromEnvironment: 'staging',
      toEnvironment: 'production',
      abComparison,
    },
    response: null,
    createdAt: now,
    resolvedAt: null,
  }
  await db.insert(schema.approvalRequests).values(approvalRequest)

  const promotion = {
    id: newAgentEnvironmentPromotionId(),
    agentProfileId: args.agentProfileId,
    probationRecordId: record.id,
    fromEnvironment: 'staging' as const,
    toEnvironment: 'production' as const,
    status: 'requested' as const,
    approvalRequestId: approvalRequest.id,
    abComparison,
    decisionNote: args.note ?? '',
    createdAt: now,
    updatedAt: now,
    decidedAt: null,
  }
  await db.insert(schema.agentEnvironmentPromotions).values(promotion)
  return promotion
}

export async function decideAgentProductionPromotion(
  promotionId: string,
  args: DecideAgentPromotionArgs,
): Promise<AgentEnvironmentPromotionRow> {
  const promotion = await getRequiredPromotion(promotionId)
  if (promotion.status === 'promoted') throw new Error(`Promotion is already applied: ${promotionId}`)
  const now = Date.now()
  const status = args.decision
  await db
    .update(schema.agentEnvironmentPromotions)
    .set({
      status,
      decisionNote: args.note ?? '',
      updatedAt: now,
      decidedAt: now,
    })
    .where(eq(schema.agentEnvironmentPromotions.id, promotionId))
  if (promotion.approvalRequestId) {
    await db
      .update(schema.approvalRequests)
      .set({
        status,
        response: { decision: args.decision, note: args.note ?? '' },
        resolvedAt: now,
      })
      .where(eq(schema.approvalRequests.id, promotion.approvalRequestId))
  }
  return getRequiredPromotion(promotionId)
}

export async function applyAgentProductionPromotion(
  promotionId: string,
): Promise<AgentEnvironmentPromotionRow> {
  const promotion = await getRequiredPromotion(promotionId)
  if (promotion.status !== 'approved') {
    throw new Error(`Promotion must be approved before apply: ${promotionId}`)
  }
  const record = promotion.probationRecordId
    ? await getRequiredProbationRecord(promotion.probationRecordId)
    : await ensureAgentProbationRecord({ agentProfileId: promotion.agentProfileId })
  const now = Date.now()
  const productionRiskTier = classifyRiskTier({
    status: 'graduated',
    environment: 'production',
    taskCount: record.taskCount,
    successRate: record.successRate,
  })
  await db
    .update(schema.agentProbationRecords)
    .set({
      environment: 'production',
      status: 'graduated',
      riskTier: productionRiskTier,
      restrictions: {
        probationRestrictionsActive: false,
        normalAutonomyPolicyRestored: true,
        highRiskActionsStillRequireApproval: true,
      },
      evaluation: {
        ...record.evaluation,
        productionPromotionId: promotion.id,
        promotedAt: now,
        productionRiskTier,
      },
      graduatedAt: record.graduatedAt ?? now,
      updatedAt: now,
    })
    .where(eq(schema.agentProbationRecords.id, record.id))
  await db
    .update(schema.agentEnvironmentPromotions)
    .set({
      status: 'promoted',
      updatedAt: now,
      decidedAt: promotion.decidedAt ?? now,
    })
    .where(eq(schema.agentEnvironmentPromotions.id, promotionId))
  return getRequiredPromotion(promotionId)
}

export async function listAgentEnvironmentPromotions(args: {
  agentProfileId?: string
  status?: AgentEnvironmentPromotionRow['status']
  limit?: number
} = {}): Promise<AgentEnvironmentPromotionRow[]> {
  const rows = await db.query.agentEnvironmentPromotions.findMany({
    orderBy: [desc(schema.agentEnvironmentPromotions.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
  return rows.filter((row) =>
    (!args.agentProfileId || row.agentProfileId === args.agentProfileId) &&
    (!args.status || row.status === args.status),
  )
}

async function buildAbComparison(args: {
  stagingAgentProfileId: string
  productionAgentProfileId?: string
}): Promise<JsonObject> {
  const staging = await summarizeRuns(args.stagingAgentProfileId)
  const production = args.productionAgentProfileId
    ? await summarizeRuns(args.productionAgentProfileId)
    : null
  return {
    mode: production ? 'staging_vs_production' : 'staging_only',
    staging,
    production,
    recommendation:
      staging.taskCount >= 10 && staging.successRate > 0.8
        ? 'eligible_for_user_review'
        : 'collect_more_staging_runs_before_promotion',
  }
}

async function summarizeRuns(agentProfileId: string): Promise<RunSummary> {
  const runs = await db.query.employeeRuns.findMany({
    where: eq(schema.employeeRuns.agentProfileId, agentProfileId),
    orderBy: [desc(schema.employeeRuns.createdAt)],
    limit: 100,
  })
  const terminalRuns = runs.filter((run) => ['complete', 'failed', 'aborted'].includes(run.status))
  const successCount = terminalRuns.filter((run) => run.status === 'complete').length
  const taskCount = terminalRuns.length
  const totals = terminalRuns.reduce(
    (acc, run) => {
      acc.costCents += run.actualCostCents
      acc.steps += Array.isArray(run.plan) ? run.plan.length : 0
      return acc
    },
    { costCents: 0, steps: 0 },
  )
  return {
    agentProfileId,
    taskCount,
    successCount,
    successRate: taskCount > 0 ? successCount / taskCount : 0,
    averageCostCents: taskCount > 0 ? totals.costCents / taskCount : 0,
    averagePlannedSteps: taskCount > 0 ? totals.steps / taskCount : 0,
  }
}

function nextProbationStatus(
  current: AgentProbationStatus,
  eligible: boolean,
  autoGraduate: boolean,
): AgentProbationStatus {
  if (current === 'blocked' || current === 'graduated') return current
  if (eligible && autoGraduate) return 'graduated'
  if (eligible) return 'eligible_for_promotion'
  return 'probation'
}

function classifyRiskTier(args: {
  status: AgentProbationStatus
  environment: AgentDeploymentEnvironment
  taskCount: number
  successRate: number
}): AgentRiskTier {
  if (args.status === 'blocked') return 'critical'
  if (args.status !== 'graduated') return 'high'
  if (args.environment === 'production' && args.successRate >= 0.9) return 'low'
  if (args.taskCount >= 10 && args.successRate > 0.8) return 'medium'
  return 'high'
}

async function getRequiredAgentProfile(agentProfileId: string) {
  const row = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, agentProfileId),
  })
  if (!row) throw new Error(`Agent Profile not found: ${agentProfileId}`)
  return row
}

async function getRequiredProbationRecord(id: string): Promise<AgentProbationRecordRow> {
  const row = await db.query.agentProbationRecords.findFirst({
    where: eq(schema.agentProbationRecords.id, id),
  })
  if (!row) throw new Error(`Agent probation record not found: ${id}`)
  return row
}

async function getRequiredPromotion(id: string): Promise<AgentEnvironmentPromotionRow> {
  const row = await db.query.agentEnvironmentPromotions.findFirst({
    where: eq(schema.agentEnvironmentPromotions.id, id),
  })
  if (!row) throw new Error(`Agent environment promotion not found: ${id}`)
  return row
}
