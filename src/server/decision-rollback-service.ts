import { and, asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  BudgetEventRow,
  DecisionAuditTrailRow,
  DecisionRollbackGranularity,
  DecisionRollbackReasonType,
  DecisionRollbackRestartPlan,
  DecisionRollbackRow,
  DecisionRollbackScope,
  EmployeeRunRow,
  JsonObject,
} from '@/db/schema'
import { newDecisionRollbackId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateDecisionRollbackArgs {
  employeeRunId: string
  targetDecisionId?: string
  granularity?: DecisionRollbackGranularity
  rollback: DecisionRollbackScope
  reason: {
    type: DecisionRollbackReasonType
    description: string
    timestamp?: number
  }
  applyImmediately?: boolean
}

export interface ApplyDecisionRollbackArgs {
  rollbackId: string
  note?: string
}

const DEFAULT_SCOPE: DecisionRollbackScope = {
  fileChanges: true,
  memoryChanges: true,
  cascadeToPeers: true,
  knowledgeGraphChanges: true,
}

export async function createDecisionRollback(
  args: CreateDecisionRollbackArgs,
): Promise<DecisionRollbackRow> {
  const employeeRun = await getRequiredEmployeeRun(args.employeeRunId)
  const decisions = await listRunDecisions(employeeRun.id)
  if (decisions.length === 0) throw new Error(`Employee run has no decision audit trail: ${employeeRun.id}`)
  const target = resolveTargetDecision(decisions, args.targetDecisionId)
  const granularity = args.granularity ?? 'from_decision_onwards'
  const affected = selectAffectedDecisions(decisions, target, granularity)
  const rollbackScope = { ...DEFAULT_SCOPE, ...args.rollback }
  const affectedMemoryIds = rollbackScope.memoryChanges
    ? await listAffectedMemoryIds(employeeRun.id)
    : []
  const affectedPeerAgentIds = rollbackScope.cascadeToPeers
    ? await listAffectedPeerAgentIds(employeeRun)
    : []
  const budgetEvents = await listRunBudgetEvents(employeeRun.id)
  const costOfRollbackCents = estimateRollbackCostCents(affected, budgetEvents)
  const whatWasLost = describeLostWork(affected, rollbackScope, affectedMemoryIds, affectedPeerAgentIds)
  const now = Date.now()
  const restartPlan = buildRestartPlan({
    employeeRun,
    target,
    decisions,
    affected,
    rollbackScope,
    reasonType: args.reason.type,
    reasonDescription: args.reason.description,
  })
  const row: DecisionRollbackRow = {
    id: newDecisionRollbackId(),
    employeeRunId: employeeRun.id,
    agentProfileId: employeeRun.agentProfileId,
    targetDecisionId: target.id,
    granularity,
    rollbackScope,
    reasonType: args.reason.type,
    reasonDescription: args.reason.description.trim(),
    reasonTimestamp: args.reason.timestamp ?? now,
    affectedDecisionIds: affected.map((decision) => decision.id),
    affectedMemoryIds,
    affectedPeerAgentIds,
    whatWasLost,
    costOfRollbackCents,
    rollbackHistory: affected.map((decision) => ({
      decisionId: decision.id,
      rolledBackAt: now,
      reason: args.reason.description.trim(),
      whatWasLost: describeDecisionLoss(decision),
      costOfRollbackCents: Math.round(costOfRollbackCents / Math.max(affected.length, 1)),
    })),
    restartPlan,
    status: args.applyImmediately ? 'applied' : 'planned',
    createdAt: now,
    appliedAt: args.applyImmediately ? now : null,
  }
  await db.insert(schema.decisionRollbacks).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'decision_rollback.plan',
    resourceType: 'decision_rollback',
    resourceId: row.id,
    status: row.status === 'applied' ? 'allowed' : 'warning',
    riskLevel: rollbackScope.fileChanges || rollbackScope.memoryChanges ? 'medium' : 'low',
    message: `Decision rollback ${row.id} planned for ${affected.length} decision(s).`,
    metadata: rollbackSnapshot(row),
  })
  return row
}

export async function applyDecisionRollback(
  args: ApplyDecisionRollbackArgs,
): Promise<DecisionRollbackRow> {
  const rollback = await getRequiredDecisionRollback(args.rollbackId)
  if (rollback.status === 'applied') return rollback
  if (rollback.status === 'failed') throw new Error(`Decision rollback ${rollback.id} has failed.`)
  const appliedAt = Date.now()
  await db
    .update(schema.decisionRollbacks)
    .set({
      status: 'applied',
      appliedAt,
      rollbackHistory: rollback.rollbackHistory.map((item) => ({
        ...item,
        rolledBackAt: appliedAt,
      })),
    })
    .where(eq(schema.decisionRollbacks.id, rollback.id))

  const updated = await getRequiredDecisionRollback(rollback.id)
  await recordAuditLog({
    actorType: 'system',
    action: 'decision_rollback.apply',
    resourceType: 'decision_rollback',
    resourceId: updated.id,
    status: 'allowed',
    riskLevel: updated.rollbackScope.fileChanges || updated.rollbackScope.memoryChanges ? 'medium' : 'low',
    message: args.note?.trim() || `Decision rollback ${updated.id} applied as a non-destructive restart plan.`,
    metadata: rollbackSnapshot(updated),
  })
  return updated
}

export async function listDecisionRollbacks(args: {
  employeeRunId?: string
  status?: DecisionRollbackRow['status']
  limit?: number
} = {}): Promise<DecisionRollbackRow[]> {
  const filters = [
    args.employeeRunId ? eq(schema.decisionRollbacks.employeeRunId, args.employeeRunId) : undefined,
    args.status ? eq(schema.decisionRollbacks.status, args.status) : undefined,
  ].filter(Boolean)
  return db.query.decisionRollbacks.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.decisionRollbacks.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

async function getRequiredEmployeeRun(id: string): Promise<EmployeeRunRow> {
  const row = await db.query.employeeRuns.findFirst({ where: eq(schema.employeeRuns.id, id) })
  if (!row) throw new Error(`Employee run not found: ${id}`)
  return row
}

async function getRequiredDecisionRollback(id: string): Promise<DecisionRollbackRow> {
  const row = await db.query.decisionRollbacks.findFirst({ where: eq(schema.decisionRollbacks.id, id) })
  if (!row) throw new Error(`Decision rollback not found: ${id}`)
  return row
}

async function listRunDecisions(employeeRunId: string): Promise<DecisionAuditTrailRow[]> {
  return db.query.decisionAuditTrails.findMany({
    where: eq(schema.decisionAuditTrails.employeeRunId, employeeRunId),
    orderBy: [asc(schema.decisionAuditTrails.createdAt)],
    limit: 500,
  })
}

async function listRunBudgetEvents(employeeRunId: string): Promise<BudgetEventRow[]> {
  return db.query.budgetEvents.findMany({
    where: eq(schema.budgetEvents.employeeRunId, employeeRunId),
    orderBy: [asc(schema.budgetEvents.createdAt)],
    limit: 500,
  })
}

async function listAffectedMemoryIds(employeeRunId: string): Promise<string[]> {
  const rows = await db.query.memoryItems.findMany({
    where: eq(schema.memoryItems.sourceRunId, employeeRunId),
    limit: 200,
  })
  return rows.map((row) => row.id)
}

async function listAffectedPeerAgentIds(employeeRun: EmployeeRunRow): Promise<string[]> {
  const rows = await db.query.interAgentMessages.findMany({
    where: eq(schema.interAgentMessages.employeeRunId, employeeRun.id),
    limit: 200,
  })
  const ids = rows.flatMap((row) => [row.senderAgentProfileId, row.recipientAgentProfileId])
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id) && id !== employeeRun.agentProfileId)))
}

function resolveTargetDecision(
  decisions: DecisionAuditTrailRow[],
  targetDecisionId?: string,
): DecisionAuditTrailRow {
  if (!targetDecisionId) return decisions[decisions.length - 1]
  const target = decisions.find((decision) => decision.id === targetDecisionId)
  if (!target) throw new Error(`Target decision is not part of the employee run: ${targetDecisionId}`)
  return target
}

function selectAffectedDecisions(
  decisions: DecisionAuditTrailRow[],
  target: DecisionAuditTrailRow,
  granularity: DecisionRollbackGranularity,
): DecisionAuditTrailRow[] {
  const targetIndex = decisions.findIndex((decision) => decision.id === target.id)
  if (granularity === 'single_decision') return [target]
  if (granularity === 'step_decisions') {
    return decisions.filter((decision) => decision.decisionType === target.decisionType)
  }
  return decisions.slice(Math.max(targetIndex, 0))
}

function estimateRollbackCostCents(
  affected: DecisionAuditTrailRow[],
  budgetEvents: BudgetEventRow[],
): number {
  if (affected.length === 0) return 0
  const firstAffectedAt = Math.min(...affected.map((decision) => decision.createdAt))
  return budgetEvents
    .filter((event) => event.createdAt >= firstAffectedAt && event.amountCents > 0)
    .reduce((sum, event) => sum + event.amountCents, 0)
}

function describeLostWork(
  affected: DecisionAuditTrailRow[],
  rollbackScope: DecisionRollbackScope,
  affectedMemoryIds: string[],
  affectedPeerAgentIds: string[],
): string[] {
  const losses = affected.map((decision) => `${decision.decisionType}: ${decision.decision}`)
  if (rollbackScope.fileChanges) losses.push('file changes after the rollback point require review or restore.')
  if (rollbackScope.memoryChanges) losses.push(`${affectedMemoryIds.length} memory item(s) may need distrust or removal.`)
  if (rollbackScope.cascadeToPeers) losses.push(`${affectedPeerAgentIds.length} peer Agent(s) may need updated context.`)
  if (rollbackScope.knowledgeGraphChanges) losses.push('knowledge graph edges after the rollback point require review.')
  return losses
}

function describeDecisionLoss(decision: DecisionAuditTrailRow): string[] {
  return [
    `decision type: ${decision.decisionType}`,
    `decision: ${decision.decision}`,
    `rationale: ${decision.rationale}`,
  ]
}

function buildRestartPlan(args: {
  employeeRun: EmployeeRunRow
  target: DecisionAuditTrailRow
  decisions: DecisionAuditTrailRow[]
  affected: DecisionAuditTrailRow[]
  rollbackScope: DecisionRollbackScope
  reasonType: DecisionRollbackReasonType
  reasonDescription: string
}): DecisionRollbackRestartPlan {
  const preserved = args.decisions
    .filter((decision) => !args.affected.some((affected) => affected.id === decision.id))
    .map((decision) => decision.id)
  return {
    messageToAgent: [
      `Decision ${args.target.id} was rolled back because ${args.reasonType}: ${args.reasonDescription.trim()}.`,
      'Reconsider from that point, do not reuse blocked decisions, and rebuild the plan with fresh verification.',
    ].join(' '),
    restartFromDecisionId: args.target.id,
    replayContext: {
      employeeRunId: args.employeeRun.id,
      goal: args.employeeRun.goal,
      targetDecision: {
        id: args.target.id,
        decisionType: args.target.decisionType,
        decision: args.target.decision,
        rationale: args.target.rationale,
      },
      preservedDecisionIds: preserved,
      rollbackScope: args.rollbackScope as unknown as JsonObject,
    },
    blockedDecisionIds: args.affected.map((decision) => decision.id),
    requiredUserReview:
      args.rollbackScope.fileChanges ||
      args.rollbackScope.memoryChanges ||
      args.rollbackScope.knowledgeGraphChanges,
  }
}

function rollbackSnapshot(row: DecisionRollbackRow): JsonObject {
  return {
    employeeRunId: row.employeeRunId,
    targetDecisionId: row.targetDecisionId,
    granularity: row.granularity,
    affectedDecisionIds: row.affectedDecisionIds,
    affectedMemoryIds: row.affectedMemoryIds,
    affectedPeerAgentIds: row.affectedPeerAgentIds,
    status: row.status,
  }
}
