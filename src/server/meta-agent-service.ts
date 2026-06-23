import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  JsonObject,
  MetaAgentDigestRow,
  MetaAgentProfileRow,
  MetaAgentRecommendationRow,
  MetaAgentRecommendationStatus,
  MetaAgentRecommendationType,
  MetaAgentResponsibility,
} from '@/db/schema'
import {
  newMetaAgentDigestId,
  newMetaAgentProfileId,
  newMetaAgentRecommendationId,
} from '@/server/ids'
import { createNotification } from '@/server/notification-service'
import { recordAuditLog } from '@/server/security-service'

export interface CreateMetaAgentProfileArgs {
  name?: string
  responsibilities?: MetaAgentResponsibility[]
  specialCapabilities?: JsonObject
  restrictions?: JsonObject
  scheduleLocalTime?: string
}

export interface GenerateMetaAgentDigestArgs {
  metaAgentProfileId?: string | null
  now?: number
  budgetLimitCents?: number | null
}

export interface MetaAgentDigestResult {
  metaAgentProfile: MetaAgentProfileRow
  digest: MetaAgentDigestRow
  recommendations: MetaAgentRecommendationRow[]
}

const defaultResponsibilities: MetaAgentResponsibility[] = [
  'monitor_all_agents_health',
  'suggest_agent_optimizations',
  'resolve_inter_agent_conflicts',
  'route_incoming_tasks',
  'detect_anomalies',
  'generate_daily_digest',
  'manage_resource_allocation',
  'onboard_new_agents',
  'retire_underperforming_agents',
]

const defaultSpecialCapabilities: JsonObject = {
  canPauseOtherAgents: true,
  canModifyAgentConfig: false,
  canCreateNewAgents: false,
  hasGlobalMemoryAccess: true,
  hasAuditAccess: true,
}

const defaultRestrictions: JsonObject = {
  cannotDeleteAgents: true,
  cannotAccessSecrets: true,
  cannotExecuteOutsideSandbox: true,
  allConfigChangesRequireApproval: true,
}

export async function createMetaAgentProfile(
  args: CreateMetaAgentProfileArgs = {},
): Promise<MetaAgentProfileRow> {
  const now = Date.now()
  const row: MetaAgentProfileRow = {
    id: newMetaAgentProfileId(),
    name: args.name?.trim() || 'System Meta Agent',
    status: 'active',
    responsibilities: args.responsibilities?.length ? args.responsibilities : defaultResponsibilities,
    specialCapabilities: {
      ...defaultSpecialCapabilities,
      ...(args.specialCapabilities ?? {}),
    },
    restrictions: {
      ...defaultRestrictions,
      ...(args.restrictions ?? {}),
    },
    scheduleLocalTime: args.scheduleLocalTime?.trim() || '08:00',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.metaAgentProfiles).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'meta_agent.profile.create',
    resourceType: 'meta_agent_profile',
    resourceId: row.id,
    riskLevel: 'medium',
    status: 'warning',
    message: 'Created a restricted Meta Agent profile.',
    metadata: {
      responsibilities: row.responsibilities,
      restrictions: row.restrictions,
    },
  })
  return row
}

export async function listMetaAgentProfiles(limit = 50): Promise<MetaAgentProfileRow[]> {
  return db.query.metaAgentProfiles.findMany({
    orderBy: [desc(schema.metaAgentProfiles.createdAt)],
    limit,
  })
}

export async function generateMetaAgentDigest(
  args: GenerateMetaAgentDigestArgs = {},
): Promise<MetaAgentDigestResult> {
  const metaAgentProfile = await resolveMetaAgentProfile(args.metaAgentProfileId)
  const now = args.now ?? Date.now()
  const dateLabel = new Date(now).toISOString().slice(0, 10)
  const agents = await db.query.agentProfiles.findMany()
  const runs = await db.query.employeeRuns.findMany()
  const approvals = await db.query.approvalRequests.findMany()
  const conflicts = await db.query.conflictResolutions.findMany()
  const editConflicts = await db.query.editConflicts.findMany()
  const taskItems = await db.query.taskQueueItems.findMany()

  const agentScores = buildAgentScores(agents, runs)
  const warningAgents = agentScores.filter((score) => score.score < 70 && score.score >= 40)
  const criticalAgents = agentScores.filter((score) => score.score < 40)
  const readyAgents = agentScores.filter((score) => score.score >= 70)
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending')
  const openConflicts = conflicts.filter((conflict) => conflict.status === 'open')
  const openEditConflicts = editConflicts.filter((conflict) => conflict.status === 'open')
  const queuedTasks = taskItems.filter((item) => item.status === 'queued' || item.status === 'running')
  const monthStart = startOfMonth(now)
  const monthlyRuns = runs.filter((run) => run.createdAt >= monthStart && run.createdAt <= now)
  const monthlyCostCents = monthlyRuns.reduce(
    (sum, run) => sum + (run.actualCostCents || run.estimatedCostCents || 0),
    0,
  )
  const budgetRemainingPercent = args.budgetLimitCents
    ? Math.max(0, Math.round((1 - monthlyCostCents / args.budgetLimitCents) * 10000) / 100)
    : null
  const failedRunCount = runs.filter((run) => run.status === 'failed' || run.status === 'aborted').length
  const anomalies = buildAnomalies({
    criticalAgents,
    warningAgents,
    pendingApprovals: pendingApprovals.length,
    openConflicts: openConflicts.length + openEditConflicts.length,
    queuedTasks: queuedTasks.length,
    budgetRemainingPercent,
  })
  const recommendationDrafts = buildRecommendationDrafts({
    metaAgentProfile,
    agentScores,
    pendingApprovals,
    openConflicts: [...openConflicts, ...openEditConflicts],
    queuedTasks,
    budgetRemainingPercent,
  })

  const digest: MetaAgentDigestRow = {
    id: newMetaAgentDigestId(),
    metaAgentProfileId: metaAgentProfile.id,
    dateLabel,
    summary: buildDigestSummary({
      readyAgents: readyAgents.length,
      warningAgents: warningAgents.length,
      criticalAgents: criticalAgents.length,
      pendingApprovals: pendingApprovals.length,
      openConflicts: openConflicts.length + openEditConflicts.length,
      queuedTasks: queuedTasks.length,
      monthlyCostCents,
    }),
    readyAgentCount: readyAgents.length,
    warningAgentCount: warningAgents.length,
    criticalAgentCount: criticalAgents.length,
    pendingApprovalCount: pendingApprovals.length,
    openConflictCount: openConflicts.length + openEditConflicts.length,
    queuedTaskCount: queuedTasks.length,
    failedRunCount,
    monthlyCostCents,
    budgetRemainingPercent,
    anomalies,
    recommendations: recommendationDrafts.map((draft) => draft.title),
    createdAt: now,
  }
  await db.insert(schema.metaAgentDigests).values(digest)

  const recommendations: MetaAgentRecommendationRow[] = recommendationDrafts.map((draft) => ({
    id: newMetaAgentRecommendationId(),
    metaAgentProfileId: metaAgentProfile.id,
    digestId: digest.id,
    recommendationType: draft.recommendationType,
    severity: draft.severity,
    targetType: draft.targetType,
    targetId: draft.targetId,
    title: draft.title,
    rationale: draft.rationale,
    proposedAction: draft.proposedAction,
    requiresApproval: draft.requiresApproval,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }))
  if (recommendations.length) {
    await db.insert(schema.metaAgentRecommendations).values(recommendations)
  }

  await createNotification({
    channel: 'in_app',
    level: criticalAgents.length ? 'critical' : warningAgents.length || pendingApprovals.length ? 'warning' : 'info',
    sourceType: 'meta_agent_digest',
    sourceId: digest.id,
    title: 'Meta Agent daily digest',
    message: digest.summary,
    payload: {
      recommendations: recommendations.map((recommendation) => recommendation.id),
      anomalies,
    },
  })
  await recordAuditLog({
    actorType: 'system',
    action: 'meta_agent.digest.generate',
    resourceType: 'meta_agent_digest',
    resourceId: digest.id,
    status: criticalAgents.length ? 'warning' : 'allowed',
    riskLevel: criticalAgents.length ? 'medium' : 'low',
    message: digest.summary,
    metadata: {
      recommendations: recommendations.map((recommendation) => recommendation.id),
      restrictions: metaAgentProfile.restrictions,
    },
  })

  return { metaAgentProfile, digest, recommendations }
}

export async function listMetaAgentDigests(limit = 50): Promise<MetaAgentDigestRow[]> {
  return db.query.metaAgentDigests.findMany({
    orderBy: [desc(schema.metaAgentDigests.createdAt)],
    limit,
  })
}

export async function listMetaAgentRecommendations(args: {
  status?: MetaAgentRecommendationStatus
  digestId?: string
  limit?: number
} = {}): Promise<MetaAgentRecommendationRow[]> {
  const rows = await db.query.metaAgentRecommendations.findMany({
    orderBy: [desc(schema.metaAgentRecommendations.createdAt)],
    limit: args.limit ?? 100,
  })
  return rows.filter((row) => {
    if (args.status && row.status !== args.status) return false
    if (args.digestId && row.digestId !== args.digestId) return false
    return true
  })
}

export async function updateMetaAgentRecommendationStatus(
  id: string,
  status: MetaAgentRecommendationStatus,
): Promise<MetaAgentRecommendationRow> {
  const existing = await db.query.metaAgentRecommendations.findFirst({
    where: eq(schema.metaAgentRecommendations.id, id.trim()),
  })
  if (!existing) throw new Error(`Meta Agent recommendation not found: ${id}`)
  await db
    .update(schema.metaAgentRecommendations)
    .set({ status, updatedAt: Date.now() })
    .where(eq(schema.metaAgentRecommendations.id, existing.id))
  await recordAuditLog({
    actorType: 'system',
    action: 'meta_agent.recommendation.status',
    resourceType: 'meta_agent_recommendation',
    resourceId: existing.id,
    status: status === 'dismissed' ? 'warning' : 'allowed',
    riskLevel: existing.severity === 'critical' ? 'high' : 'medium',
    message: `Meta Agent recommendation marked ${status}.`,
    metadata: {
      recommendationType: existing.recommendationType,
      requiresApproval: existing.requiresApproval,
    },
  })
  const updated = await db.query.metaAgentRecommendations.findFirst({
    where: eq(schema.metaAgentRecommendations.id, existing.id),
  })
  if (!updated) throw new Error(`Meta Agent recommendation not found after update: ${id}`)
  return updated
}

async function resolveMetaAgentProfile(id?: string | null): Promise<MetaAgentProfileRow> {
  if (id) {
    const row = await db.query.metaAgentProfiles.findFirst({
      where: eq(schema.metaAgentProfiles.id, id.trim()),
    })
    if (!row) throw new Error(`Meta Agent profile not found: ${id}`)
    return row
  }
  const existing = await db.query.metaAgentProfiles.findFirst({
    where: eq(schema.metaAgentProfiles.status, 'active'),
    orderBy: [desc(schema.metaAgentProfiles.createdAt)],
  })
  return existing ?? createMetaAgentProfile()
}

interface AgentScore {
  agent: AgentProfileRow
  runCount: number
  failedCount: number
  completedCount: number
  score: number
  recentFailures: number
}

function buildAgentScores(agents: AgentProfileRow[], runs: Awaited<ReturnType<typeof db.query.employeeRuns.findMany>>): AgentScore[] {
  return agents.map((agent) => {
    const agentRuns = runs.filter((run) => run.agentProfileId === agent.id)
    const completedCount = agentRuns.filter((run) => run.status === 'complete').length
    const failedCount = agentRuns.filter((run) => run.status === 'failed' || run.status === 'aborted').length
    const recentFailures = agentRuns
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 3)
      .filter((run) => run.status === 'failed' || run.status === 'aborted').length
    const successRate = agentRuns.length ? completedCount / agentRuns.length : 1
    const failurePenalty = agentRuns.length ? failedCount / agentRuns.length : 0
    const score = Math.max(0, Math.min(100, Math.round((100 * successRate - 45 * failurePenalty) * 100) / 100))
    return { agent, runCount: agentRuns.length, failedCount, completedCount, score, recentFailures }
  })
}

interface RecommendationDraft {
  recommendationType: MetaAgentRecommendationType
  severity: MetaAgentRecommendationRow['severity']
  targetType: string
  targetId: string | null
  title: string
  rationale: string
  proposedAction: JsonObject
  requiresApproval: boolean
}

function buildRecommendationDrafts(args: {
  metaAgentProfile: MetaAgentProfileRow
  agentScores: AgentScore[]
  pendingApprovals: Array<{ id: string }>
  openConflicts: Array<{ id: string; conflictType?: string }>
  queuedTasks: Array<{ id: string }>
  budgetRemainingPercent: number | null
}): RecommendationDraft[] {
  const drafts: RecommendationDraft[] = []
  for (const score of args.agentScores) {
    if (score.runCount === 0) {
      drafts.push({
        recommendationType: 'onboard_agent',
        severity: 'info',
        targetType: 'agent_profile',
        targetId: score.agent.id,
        title: `Onboard ${score.agent.name}`,
        rationale: 'This Agent has no employee runs yet and should receive a starter task or playbook.',
        proposedAction: { action: 'assign_starter_task', agentProfileId: score.agent.id },
        requiresApproval: true,
      })
    }
    if (score.recentFailures >= 2 || score.score < 40) {
      drafts.push({
        recommendationType: score.score < 30 ? 'retire_agent' : 'check_health',
        severity: score.score < 30 ? 'critical' : 'warning',
        targetType: 'agent_profile',
        targetId: score.agent.id,
        title: `Review ${score.agent.name}`,
        rationale: `${score.agent.name} has score ${score.score} with ${score.failedCount} failed run(s).`,
        proposedAction: {
          action: score.score < 30 ? 'create_retirement_plan' : 'compute_health_and_review_logs',
          agentProfileId: score.agent.id,
        },
        requiresApproval: true,
      })
    }
  }
  if (args.pendingApprovals.length) {
    drafts.push({
      recommendationType: 'daily_digest',
      severity: 'warning',
      targetType: 'approval_queue',
      targetId: null,
      title: `${args.pendingApprovals.length} approval request(s) pending`,
      rationale: 'Pending approvals can block autonomous Agent work.',
      proposedAction: { action: 'review_approval_queue', approvalIds: args.pendingApprovals.map((item) => item.id) },
      requiresApproval: false,
    })
  }
  if (args.openConflicts.length) {
    drafts.push({
      recommendationType: 'resolve_conflict',
      severity: 'warning',
      targetType: 'conflict',
      targetId: args.openConflicts[0]?.id ?? null,
      title: `${args.openConflicts.length} open conflict(s) need arbitration`,
      rationale: 'Open inter-Agent or config edit conflicts can stall workflow handoffs.',
      proposedAction: { action: 'open_conflict_center', conflictIds: args.openConflicts.map((item) => item.id) },
      requiresApproval: false,
    })
  }
  if (args.queuedTasks.length) {
    drafts.push({
      recommendationType: 'resource_allocation',
      severity: args.queuedTasks.length > 5 ? 'warning' : 'info',
      targetType: 'task_queue',
      targetId: null,
      title: `${args.queuedTasks.length} queued/running task(s)`,
      rationale: 'The Meta Agent should watch queue depth and resource allocation.',
      proposedAction: { action: 'review_task_queues', queuedTaskIds: args.queuedTasks.map((item) => item.id) },
      requiresApproval: false,
    })
  }
  if (args.budgetRemainingPercent !== null && args.budgetRemainingPercent < 20) {
    drafts.push({
      recommendationType: 'detect_anomaly',
      severity: 'critical',
      targetType: 'budget',
      targetId: null,
      title: `Budget remaining ${args.budgetRemainingPercent}%`,
      rationale: 'The configured budget threshold is nearly exhausted.',
      proposedAction: { action: 'pause_high_cost_runs_until_review' },
      requiresApproval: true,
    })
  }
  return drafts.slice(0, 20)
}

function buildAnomalies(args: {
  criticalAgents: AgentScore[]
  warningAgents: AgentScore[]
  pendingApprovals: number
  openConflicts: number
  queuedTasks: number
  budgetRemainingPercent: number | null
}): string[] {
  return [
    ...args.criticalAgents.map((score) => `${score.agent.name} is critical at score ${score.score}.`),
    ...args.warningAgents.map((score) => `${score.agent.name} should be watched at score ${score.score}.`),
    args.pendingApprovals ? `${args.pendingApprovals} approval request(s) are pending.` : '',
    args.openConflicts ? `${args.openConflicts} conflict(s) are open.` : '',
    args.queuedTasks > 5 ? `${args.queuedTasks} queued/running task(s) may need resource review.` : '',
    args.budgetRemainingPercent !== null && args.budgetRemainingPercent < 20
      ? `Budget remaining is ${args.budgetRemainingPercent}%.`
      : '',
  ].filter(Boolean)
}

function buildDigestSummary(args: {
  readyAgents: number
  warningAgents: number
  criticalAgents: number
  pendingApprovals: number
  openConflicts: number
  queuedTasks: number
  monthlyCostCents: number
}): string {
  return [
    `Agent team: ${args.readyAgents} ready, ${args.warningAgents} warning, ${args.criticalAgents} critical.`,
    `${args.pendingApprovals} approval(s), ${args.openConflicts} conflict(s), ${args.queuedTasks} queued/running task(s).`,
    `Monthly estimated spend: ${args.monthlyCostCents}c.`,
  ].join(' ')
}

function startOfMonth(now: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}
