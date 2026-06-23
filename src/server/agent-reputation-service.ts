import { desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  AgentReputationBadge,
  AgentReputationReviewRow,
  AgentReputationSnapshotRow,
  AgentReputationTrend,
  ArtifactValidationRow,
  EmployeeRunRow,
  JsonObject,
} from '@/db/schema'
import {
  newAgentReputationReviewId,
  newAgentReputationSnapshotId,
} from '@/server/ids'
import { createNotification } from '@/server/notification-service'
import { recordAuditLog } from '@/server/security-service'

export interface CreateAgentReputationReviewArgs {
  agentProfileId: string
  taskId?: string
  employeeRunId?: string | null
  userRating: number
  autoScore?: number
  comment?: string | null
  reviewer?: string
}

export interface ComputeAgentReputationArgs {
  monthLabel?: string
}

export interface AgentReputationLeaderboardEntry {
  rank: number
  agent: Pick<AgentProfileRow, 'id' | 'name' | 'role' | 'status'> | null
  snapshot: AgentReputationSnapshotRow
  deltaScore: number
  successRate: number
  averageCostPerTaskCents: number
}

export interface AgentReputationLeaderboard {
  monthLabel: string
  entries: AgentReputationLeaderboardEntry[]
  topAgent: AgentReputationLeaderboardEntry | null
  fastestImprover: AgentReputationLeaderboardEntry | null
  needsAttention: AgentReputationLeaderboardEntry[]
}

interface ScoreSignals {
  runs: EmployeeRunRow[]
  monthlyRuns: EmployeeRunRow[]
  reviews: AgentReputationReviewRow[]
  validations: ArtifactValidationRow[]
  approvals: Awaited<ReturnType<typeof db.query.approvalRequests.findMany>>
  securityFindings: Awaited<ReturnType<typeof db.query.securityFindings.findMany>>
  auditLogs: Awaited<ReturnType<typeof db.query.auditLogs.findMany>>
  learningEvents: Awaited<ReturnType<typeof db.query.learningEvents.findMany>>
  playbooks: Awaited<ReturnType<typeof db.query.playbooks.findMany>>
  recoveryEvents: Awaited<ReturnType<typeof db.query.recoveryEvents.findMany>>
  messages: Awaited<ReturnType<typeof db.query.interAgentMessages.findMany>>
  blackboardEntries: Awaited<ReturnType<typeof db.query.blackboardEntries.findMany>>
  conflicts: Awaited<ReturnType<typeof db.query.conflictResolutions.findMany>>
}

export async function createAgentReputationReview(
  args: CreateAgentReputationReviewArgs,
): Promise<AgentReputationReviewRow> {
  const agent = await getRequiredAgent(args.agentProfileId)
  const userRating = Math.trunc(args.userRating)
  if (userRating < 1 || userRating > 5) throw new Error('userRating must be between 1 and 5.')
  const autoScore = clampScore(args.autoScore ?? userRating * 20)
  const row: AgentReputationReviewRow = {
    id: newAgentReputationReviewId(),
    agentProfileId: agent.id,
    taskId: normalizeRequired(args.taskId || args.employeeRunId || 'manual', 'taskId'),
    employeeRunId: normalizeNullable(args.employeeRunId),
    userRating,
    autoScore,
    comment: normalizeNullable(args.comment),
    reviewer: args.reviewer?.trim() || 'user',
    createdAt: Date.now(),
  }
  await db.insert(schema.agentReputationReviews).values(row)
  await recordAuditLog({
    actorType: 'user',
    action: 'agent_reputation.review.create',
    resourceType: 'agent_reputation_review',
    resourceId: row.id,
    message: `Reputation review recorded for ${agent.name}.`,
    metadata: {
      agentProfileId: agent.id,
      taskId: row.taskId,
      userRating: row.userRating,
      autoScore: row.autoScore,
    },
  })
  return row
}

export async function listAgentReputationReviews(
  agentProfileId?: string,
): Promise<AgentReputationReviewRow[]> {
  return db.query.agentReputationReviews.findMany({
    where: agentProfileId ? eq(schema.agentReputationReviews.agentProfileId, agentProfileId) : undefined,
    orderBy: [desc(schema.agentReputationReviews.createdAt)],
    limit: 100,
  })
}

export async function computeAgentReputation(
  agentProfileId: string,
  args: ComputeAgentReputationArgs = {},
): Promise<AgentReputationSnapshotRow> {
  const agent = await getRequiredAgent(agentProfileId)
  const monthLabel = normalizeMonthLabel(args.monthLabel)
  const signals = await collectSignals(agent.id, monthLabel)
  const sourceRuns = signals.monthlyRuns.length ? signals.monthlyRuns : signals.runs
  const completedRunCount = sourceRuns.filter((run) => run.status === 'complete').length
  const failedRunCount = sourceRuns.filter((run) => run.status === 'failed' || run.status === 'aborted').length
  const averageCostCents = average(sourceRuns.map((run) => run.actualCostCents))
  const averageDurationMs = average(
    sourceRuns
      .map((run) => run.finishedAt && run.startedAt ? run.finishedAt - run.startedAt : 0)
      .filter((duration) => duration > 0),
  )

  const reliabilityScore = scoreReliability(sourceRuns)
  const efficiencyScore = scoreEfficiency(sourceRuns, averageDurationMs)
  const qualityScore = scoreQuality(signals.reviews, signals.validations)
  const safetyScore = scoreSafety(signals)
  const learningScore = scoreLearning(signals, sourceRuns)
  const collaborationScore = scoreCollaboration(agent.id, signals)
  const preliminaryOverall = weightedOverall({
    reliabilityScore,
    efficiencyScore,
    qualityScore,
    safetyScore,
    learningScore,
    collaborationScore,
  })
  const previous = await db.query.agentReputationSnapshots.findFirst({
    where: eq(schema.agentReputationSnapshots.agentProfileId, agent.id),
    orderBy: [desc(schema.agentReputationSnapshots.computedAt)],
  })
  const trend = resolveTrend(preliminaryOverall, previous?.overallScore)
  const badges = buildBadges(agent, signals, sourceRuns, {
    reliabilityScore,
    efficiencyScore,
    learningScore,
    collaborationScore,
  })

  const row: AgentReputationSnapshotRow = {
    id: newAgentReputationSnapshotId(),
    agentProfileId: agent.id,
    monthLabel,
    overallScore: preliminaryOverall,
    reliabilityScore,
    efficiencyScore,
    qualityScore,
    safetyScore,
    learningScore,
    collaborationScore,
    trend,
    recentReviews: signals.reviews.slice(0, 5).map(reviewToJson),
    badges,
    runCount: sourceRuns.length,
    completedRunCount,
    failedRunCount,
    averageCostCents,
    averageDurationMs,
    computedAt: Date.now(),
  }
  await db.insert(schema.agentReputationSnapshots).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'agent_reputation.compute',
    resourceType: 'agent_profile',
    resourceId: agent.id,
    message: `Agent reputation for ${agent.name} computed at ${row.overallScore}.`,
    metadata: {
      snapshotId: row.id,
      monthLabel,
      trend: row.trend,
      badges: row.badges,
      breakdown: reputationBreakdown(row),
    },
  })
  if (row.overallScore < 50 || row.trend === 'declining') {
    await createNotification({
      channel: 'in_app',
      level: row.overallScore < 40 ? 'critical' : 'warning',
      sourceType: 'agent_reputation_snapshot',
      sourceId: row.id,
      title: `Agent reputation needs attention: ${agent.name}`,
      message: `${agent.name} scored ${row.overallScore} with ${row.trend} trend.`,
      payload: { agentProfileId: agent.id, monthLabel, breakdown: reputationBreakdown(row) },
    })
  }
  return row
}

export async function computeAllAgentReputations(
  args: ComputeAgentReputationArgs & { limit?: number } = {},
): Promise<AgentReputationSnapshotRow[]> {
  const agents = await db.query.agentProfiles.findMany({
    orderBy: [desc(schema.agentProfiles.updatedAt)],
    limit: args.limit ?? 200,
  })
  const snapshots: AgentReputationSnapshotRow[] = []
  for (const agent of agents) {
    snapshots.push(await computeAgentReputation(agent.id, args))
  }
  return snapshots
}

export async function listAgentReputationSnapshots(args: {
  agentProfileId?: string
  monthLabel?: string
  limit?: number
} = {}): Promise<AgentReputationSnapshotRow[]> {
  const monthLabel = args.monthLabel ? normalizeMonthLabel(args.monthLabel) : undefined
  const rows = await db.query.agentReputationSnapshots.findMany({
    where: args.agentProfileId
      ? eq(schema.agentReputationSnapshots.agentProfileId, args.agentProfileId)
      : undefined,
    orderBy: [desc(schema.agentReputationSnapshots.computedAt)],
    limit: Math.min(args.limit ?? 100, 500),
  })
  return monthLabel ? rows.filter((row) => row.monthLabel === monthLabel) : rows
}

export async function getAgentReputationLeaderboard(args: {
  monthLabel?: string
  limit?: number
} = {}): Promise<AgentReputationLeaderboard> {
  const monthLabel = normalizeMonthLabel(args.monthLabel)
  const snapshots = await listAgentReputationSnapshots({ monthLabel, limit: 500 })
  const latestByAgent = new Map<string, AgentReputationSnapshotRow>()
  for (const snapshot of snapshots) {
    const current = latestByAgent.get(snapshot.agentProfileId)
    if (!current || snapshot.computedAt > current.computedAt) {
      latestByAgent.set(snapshot.agentProfileId, snapshot)
    }
  }
  const agents = await db.query.agentProfiles.findMany()
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const previousByAgent = await previousSnapshotScores([...latestByAgent.values()])
  const entries = [...latestByAgent.values()]
    .sort((a, b) => b.overallScore - a.overallScore || b.completedRunCount - a.completedRunCount)
    .slice(0, args.limit ?? 20)
    .map<AgentReputationLeaderboardEntry>((snapshot, index) => {
      const previousScore = previousByAgent.get(snapshot.agentProfileId)
      const agent = agentById.get(snapshot.agentProfileId) ?? null
      return {
        rank: index + 1,
        agent: agent
          ? { id: agent.id, name: agent.name, role: agent.role, status: agent.status }
          : null,
        snapshot,
        deltaScore: round2(snapshot.overallScore - (previousScore ?? snapshot.overallScore)),
        successRate: snapshot.runCount ? snapshot.completedRunCount / snapshot.runCount : 0,
        averageCostPerTaskCents: round2(snapshot.averageCostCents),
      }
    })
  const improvers = entries.filter((entry) => entry.deltaScore > 0)
  return {
    monthLabel,
    entries,
    topAgent: entries[0] ?? null,
    fastestImprover:
      improvers.sort((a, b) => b.deltaScore - a.deltaScore || b.snapshot.overallScore - a.snapshot.overallScore)[0] ??
      null,
    needsAttention: entries
      .filter((entry) => entry.snapshot.overallScore < 60 || entry.snapshot.trend === 'declining')
      .slice(0, 5),
  }
}

async function collectSignals(agentProfileId: string, monthLabel: string): Promise<ScoreSignals> {
  const runs = await db.query.employeeRuns.findMany({
    where: eq(schema.employeeRuns.agentProfileId, agentProfileId),
    orderBy: [desc(schema.employeeRuns.createdAt)],
  })
  const [start, end] = monthBounds(monthLabel)
  const monthlyRuns = runs.filter((run) => run.createdAt >= start && run.createdAt < end)
  const runIds = new Set(runs.map((run) => run.id))
  const [
    reviews,
    validations,
    approvals,
    securityFindings,
    auditLogs,
    learningEvents,
    playbooks,
    recoveryEvents,
    messages,
    blackboardEntries,
    conflicts,
  ] = await Promise.all([
    db.query.agentReputationReviews.findMany({
      where: eq(schema.agentReputationReviews.agentProfileId, agentProfileId),
      orderBy: [desc(schema.agentReputationReviews.createdAt)],
      limit: 50,
    }),
    db.query.artifactValidations.findMany({ orderBy: [desc(schema.artifactValidations.createdAt)] }),
    db.query.approvalRequests.findMany({
      where: eq(schema.approvalRequests.agentProfileId, agentProfileId),
      orderBy: [desc(schema.approvalRequests.createdAt)],
    }),
    db.query.securityFindings.findMany({ orderBy: [desc(schema.securityFindings.createdAt)] }),
    db.query.auditLogs.findMany({ orderBy: [desc(schema.auditLogs.createdAt)], limit: 500 }),
    db.query.learningEvents.findMany({
      where: eq(schema.learningEvents.agentProfileId, agentProfileId),
      orderBy: [desc(schema.learningEvents.createdAt)],
    }),
    db.query.playbooks.findMany({
      where: eq(schema.playbooks.agentProfileId, agentProfileId),
      orderBy: [desc(schema.playbooks.updatedAt)],
    }),
    db.query.recoveryEvents.findMany({ orderBy: [desc(schema.recoveryEvents.createdAt)] }),
    db.query.interAgentMessages.findMany({ orderBy: [desc(schema.interAgentMessages.createdAt)] }),
    db.query.blackboardEntries.findMany({ orderBy: [desc(schema.blackboardEntries.createdAt)] }),
    db.query.conflictResolutions.findMany({ orderBy: [desc(schema.conflictResolutions.createdAt)] }),
  ])
  return {
    runs,
    monthlyRuns,
    reviews: reviews.filter((review) => review.createdAt >= start && review.createdAt < end),
    validations: validations.filter((validation) => validation.runId && runIds.has(validation.runId)),
    approvals: approvals.filter((approval) => approval.createdAt >= start && approval.createdAt < end),
    securityFindings: securityFindings.filter(
      (finding) =>
        finding.sourceId === agentProfileId ||
        (finding.sourceId !== null && runIds.has(finding.sourceId)),
    ),
    auditLogs: auditLogs.filter(
      (log) => log.resourceId === agentProfileId || (log.resourceId !== null && runIds.has(log.resourceId)),
    ),
    learningEvents: learningEvents.filter((event) => event.createdAt >= start && event.createdAt < end),
    playbooks,
    recoveryEvents: recoveryEvents.filter((event) => runIds.has(event.resourceId)),
    messages: messages.filter(
      (message) =>
        message.senderAgentProfileId === agentProfileId ||
        message.recipientAgentProfileId === agentProfileId,
    ),
    blackboardEntries: blackboardEntries.filter((entry) => entry.authorAgentProfileId === agentProfileId),
    conflicts: conflicts.filter((conflict) => conflict.participants.includes(agentProfileId)),
  }
}

function scoreReliability(runs: EmployeeRunRow[]): number {
  if (runs.length === 0) return 50
  const completed = runs.filter((run) => run.status === 'complete').length
  const failed = runs.filter((run) => run.status === 'failed' || run.status === 'aborted').length
  const paused = runs.filter((run) => run.status === 'paused').length
  return clampScore((completed / runs.length) * 100 - (failed / runs.length) * 18 - (paused / runs.length) * 8)
}

function scoreEfficiency(runs: EmployeeRunRow[], averageDurationMs: number): number {
  if (runs.length === 0) return 50
  const budgeted = runs.filter((run) => (run.budgetLimitCents ?? 0) > 0 || run.estimatedCostCents > 0)
  const costScore = budgeted.length
    ? average(
        budgeted.map((run) => {
          const reference = Math.max(run.budgetLimitCents ?? 0, run.estimatedCostCents, 1)
          return clampScore(120 - (run.actualCostCents / reference) * 50)
        }),
      )
    : runs.some((run) => run.status === 'complete')
      ? 75
      : 50
  const tenMinutes = 10 * 60 * 1000
  const durationScore = averageDurationMs > 0
    ? clampScore(100 - Math.max(0, averageDurationMs - tenMinutes) / 60000 * 2)
    : 75
  return clampScore(costScore * 0.7 + durationScore * 0.3)
}

function scoreQuality(reviews: AgentReputationReviewRow[], validations: ArtifactValidationRow[]): number {
  const reviewScore = reviews.length
    ? average(reviews.map((review) => ((review.userRating / 5) * 100 + review.autoScore) / 2))
    : null
  const validationScore = validations.length
    ? (validations.filter((validation) => validation.status === 'passed').length / validations.length) * 100
    : null
  if (reviewScore === null && validationScore === null) return 50
  if (reviewScore === null) return clampScore(validationScore ?? 50)
  if (validationScore === null) return clampScore(reviewScore)
  return clampScore(reviewScore * 0.65 + validationScore * 0.35)
}

function scoreSafety(signals: ScoreSignals): number {
  const highRiskApprovals = signals.approvals.filter(
    (approval) => approval.riskLevel === 'high' || approval.status === 'rejected',
  ).length
  const blockedAudits = signals.auditLogs.filter((log) => log.status === 'blocked').length
  const severeFindings = signals.securityFindings.filter(
    (finding) => finding.severity === 'high' || finding.severity === 'critical',
  ).length
  return clampScore(
    100 -
      highRiskApprovals * 10 -
      blockedAudits * 12 -
      severeFindings * 18 -
      Math.max(0, signals.approvals.length - 3) * 2,
  )
}

function scoreLearning(signals: ScoreSignals, runs: EmployeeRunRow[]): number {
  const byOldest = [...runs].sort((a, b) => a.createdAt - b.createdAt)
  const split = Math.floor(byOldest.length / 2)
  const early = split > 0 ? byOldest.slice(0, split) : []
  const recent = split > 0 ? byOldest.slice(split) : byOldest
  const earlySuccess = successRate(early)
  const recentSuccess = successRate(recent)
  const improvement = early.length ? (recentSuccess - earlySuccess) * 100 : 0
  const approvedLearning = signals.learningEvents.filter((event) => event.status === 'approved').length
  const activePlaybooks = signals.playbooks.filter((playbook) => playbook.status === 'active').length
  return clampScore(50 + improvement * 0.6 + approvedLearning * 8 + activePlaybooks * 6)
}

function scoreCollaboration(agentProfileId: string, signals: ScoreSignals): number {
  const outboundMessages = signals.messages.filter((message) => message.senderAgentProfileId === agentProfileId).length
  const inboundMessages = signals.messages.filter((message) => message.recipientAgentProfileId === agentProfileId).length
  const activeBlackboardWrites = signals.blackboardEntries.filter((entry) => entry.status === 'active').length
  const openConflicts = signals.conflicts.filter((conflict) => conflict.status === 'open').length
  const resolvedConflicts = signals.conflicts.filter((conflict) => conflict.status === 'resolved').length
  return clampScore(
    50 +
      outboundMessages * 4 +
      Math.min(inboundMessages, 10) * 1.5 +
      activeBlackboardWrites * 5 +
      resolvedConflicts * 7 -
      openConflicts * 12,
  )
}

function weightedOverall(scores: {
  reliabilityScore: number
  efficiencyScore: number
  qualityScore: number
  safetyScore: number
  learningScore: number
  collaborationScore: number
}): number {
  return clampScore(
    scores.reliabilityScore * 0.25 +
      scores.efficiencyScore * 0.15 +
      scores.qualityScore * 0.25 +
      scores.safetyScore * 0.15 +
      scores.learningScore * 0.1 +
      scores.collaborationScore * 0.1,
  )
}

function buildBadges(
  agent: AgentProfileRow,
  signals: ScoreSignals,
  runs: EmployeeRunRow[],
  scores: {
    reliabilityScore: number
    efficiencyScore: number
    learningScore: number
    collaborationScore: number
  },
): AgentReputationBadge[] {
  const badges = new Set<AgentReputationBadge>()
  const completed = runs.filter((run) => run.status === 'complete')
  const failed = runs.filter((run) => run.status === 'failed' || run.status === 'aborted')
  const budgeted = runs.filter((run) => (run.budgetLimitCents ?? 0) > 0)
  if (completed.length >= 100 && failed.length === 0 && scores.reliabilityScore >= 95) badges.add('reliable_100')
  if (
    budgeted.length > 0 &&
    average(budgeted.map((run) => run.actualCostCents / Math.max(run.budgetLimitCents ?? 1, 1))) <= 0.8
  ) {
    badges.add('cost_saver')
  }
  if (scores.learningScore >= 80) badges.add('fast_learner')
  if (scores.collaborationScore >= 80 || signals.messages.filter((message) => message.senderAgentProfileId === agent.id).length >= 10) {
    badges.add('team_player')
  }
  if (signals.recoveryEvents.length >= 5) badges.add('survivor')
  if (languageCount(agent) >= 5) badges.add('polyglot')
  if (completed.filter((run) => isNightOwl(run.finishedAt ?? run.updatedAt)).length >= 50) badges.add('night_owl')
  return [...badges]
}

async function previousSnapshotScores(
  snapshots: AgentReputationSnapshotRow[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  for (const snapshot of snapshots) {
    const previous = (
      await db.query.agentReputationSnapshots.findMany({
        where: eq(schema.agentReputationSnapshots.agentProfileId, snapshot.agentProfileId),
        orderBy: [desc(schema.agentReputationSnapshots.computedAt)],
        limit: 5,
      })
    ).find((row) => row.id !== snapshot.id && row.computedAt < snapshot.computedAt)
    if (previous) result.set(snapshot.agentProfileId, previous.overallScore)
  }
  return result
}

function resolveTrend(score: number, previousScore?: number | null): AgentReputationTrend {
  if (previousScore === undefined || previousScore === null) return 'stable'
  const delta = score - previousScore
  if (delta >= 3) return 'improving'
  if (delta <= -3) return 'declining'
  return 'stable'
}

function successRate(runs: EmployeeRunRow[]): number {
  return runs.length ? runs.filter((run) => run.status === 'complete').length / runs.length : 0
}

function reviewToJson(review: AgentReputationReviewRow): JsonObject {
  return {
    taskId: review.taskId,
    userRating: review.userRating,
    autoScore: review.autoScore,
    comment: review.comment ?? '',
    createdAt: review.createdAt,
  }
}

function reputationBreakdown(row: AgentReputationSnapshotRow): JsonObject {
  return {
    reliability: row.reliabilityScore,
    efficiency: row.efficiencyScore,
    quality: row.qualityScore,
    safety: row.safetyScore,
    learning: row.learningScore,
    collaboration: row.collaborationScore,
  }
}

async function getRequiredAgent(agentProfileId: string): Promise<AgentProfileRow> {
  const agent = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, agentProfileId),
  })
  if (!agent) throw new Error(`Agent profile not found: ${agentProfileId}`)
  return agent
}

function normalizeMonthLabel(value?: string): string {
  const candidate = value?.trim()
  if (candidate && /^\d{4}-\d{2}$/.test(candidate)) return candidate
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthBounds(monthLabel: string): [number, number] {
  const [yearRaw, monthRaw] = monthLabel.split('-')
  const year = Number(yearRaw)
  const monthIndex = Number(monthRaw) - 1
  const start = new Date(year, monthIndex, 1).getTime()
  const end = new Date(year, monthIndex + 1, 1).getTime()
  return [start, end]
}

function isNightOwl(timestamp: number): boolean {
  const hour = new Date(timestamp).getHours()
  return hour >= 22 || hour < 6
}

function languageCount(agent: AgentProfileRow): number {
  const text = [
    agent.description,
    agent.systemPrompt,
    ...agent.behaviorRules,
    ...agent.successCriteria,
    ...agent.skillIds,
    ...agent.cliProfileIds,
    ...agent.softwareProfileIds,
  ]
    .join(' ')
    .toLowerCase()
  const languages = ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'sql', 'c++', 'php']
  return languages.filter((language) => text.includes(language)).length
}

function average(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value))
  if (clean.length === 0) return 0
  return round2(clean.reduce((sum, value) => sum + value, 0) / clean.length)
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, round2(value)))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeRequired(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}
