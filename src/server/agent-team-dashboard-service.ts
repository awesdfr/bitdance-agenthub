import { and, desc, eq, inArray, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  AgentTeamBlackboardItem,
  AgentTeamDashboardCard,
  AgentTeamDashboardCommandRow,
  AgentTeamDashboardCommandType,
  AgentTeamDashboardSnapshotRow,
  BlackboardScopeType,
  EmployeeRunEventRow,
  EmployeeRunRow,
  JsonObject,
} from '@/db/schema'
import {
  newAgentTeamDashboardCommandId,
  newAgentTeamDashboardSnapshotId,
} from '@/server/ids'
import {
  cancelEmployeeRun,
  pauseEmployeeRun,
  resumeEmployeeRun,
} from '@/server/employee-runtime-service'

export async function createAgentTeamDashboardSnapshot(args: {
  name?: string
  workflowRunId?: string | null
  agentProfileIds?: string[]
  blackboardScopeType?: BlackboardScopeType
  blackboardScopeId?: string
}): Promise<AgentTeamDashboardSnapshotRow> {
  const agents = await resolveAgents(args.agentProfileIds ?? [])
  const agentIds = agents.map((agent) => agent.id)
  const [runs, events, approvals, computerSessions, blackboardEntries] = await Promise.all([
    db.query.employeeRuns.findMany({
      orderBy: [desc(schema.employeeRuns.updatedAt)],
      limit: 500,
    }),
    db.query.employeeRunEvents.findMany({
      orderBy: [desc(schema.employeeRunEvents.createdAt)],
      limit: 1500,
    }),
    db.query.approvalRequests.findMany({
      where: eq(schema.approvalRequests.status, 'pending'),
      orderBy: [desc(schema.approvalRequests.createdAt)],
      limit: 500,
    }),
    db.query.computerSessions.findMany({
      orderBy: [desc(schema.computerSessions.createdAt)],
      limit: 500,
    }),
    db.query.blackboardEntries.findMany({
      where: and(
        eq(schema.blackboardEntries.scopeType, args.blackboardScopeType ?? 'global'),
        eq(schema.blackboardEntries.scopeId, args.blackboardScopeId ?? 'global'),
        eq(schema.blackboardEntries.status, 'active'),
      ),
      orderBy: [desc(schema.blackboardEntries.updatedAt)],
      limit: 20,
    }),
  ])

  const cards = agents.map((agent) =>
    buildAgentCard({
      agent,
      run: latestRunForAgent(runs, agent.id, args.workflowRunId),
      events,
      pendingApprovals: approvals.filter((approval) => approval.agentProfileId === agent.id),
      computerSessionIds: computerSessions
        .filter((session) => session.agentProfileId === agent.id)
        .map((session) => session.id),
    }),
  )
  const blackboardItems = blackboardEntries.map((entry): AgentTeamBlackboardItem => {
    const author = entry.authorAgentProfileId
      ? agents.find((agent) => agent.id === entry.authorAgentProfileId)
      : null
    return {
      id: entry.id,
      authorAgentProfileId: entry.authorAgentProfileId,
      authorName: author?.name ?? 'system',
      key: entry.key,
      summary: summarizeJson(entry.value),
      version: entry.version,
      updatedAt: entry.updatedAt,
    }
  })

  const row: AgentTeamDashboardSnapshotRow = {
    id: newAgentTeamDashboardSnapshotId(),
    name: args.name?.trim() || 'Agent Team Dashboard',
    workflowRunId: normalizeOptional(args.workflowRunId),
    agentProfileIds: agentIds,
    cards,
    blackboardItems,
    activeRunCount: cards.filter((card) => card.status === 'working').length,
    waitingApprovalCount: cards.reduce((sum, card) => sum + card.waitingApprovalCount, 0),
    blockedCount: cards.filter((card) => card.status === 'blocked' || card.status === 'waiting_approval').length,
    failedCount: cards.filter((card) => card.status === 'failed').length,
    status: 'live',
    exportManifest: {},
    summary: buildDashboardSummary(cards),
    createdAt: Date.now(),
  }
  await db.insert(schema.agentTeamDashboardSnapshots).values(row)
  return row
}

export async function listAgentTeamDashboardSnapshots(args: {
  workflowRunId?: string
  limit?: number
} = {}): Promise<AgentTeamDashboardSnapshotRow[]> {
  return db.query.agentTeamDashboardSnapshots.findMany({
    where: args.workflowRunId
      ? eq(schema.agentTeamDashboardSnapshots.workflowRunId, args.workflowRunId)
      : undefined,
    orderBy: [desc(schema.agentTeamDashboardSnapshots.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function applyAgentTeamDashboardCommand(
  snapshotId: string,
  commandType: AgentTeamDashboardCommandType,
): Promise<AgentTeamDashboardCommandRow> {
  const snapshot = await getRequiredSnapshot(snapshotId)
  const targetRunIds = targetRunIdsForCommand(snapshot.cards, commandType)
  const affectedRunIds: string[] = []
  const skippedRunIds: string[] = []
  const affectedAgentIds = new Set<string>()

  if (commandType !== 'export_report') {
    for (const runId of targetRunIds) {
      try {
        if (commandType === 'pause_all') await pauseEmployeeRun(runId)
        if (commandType === 'resume_all') await resumeEmployeeRun(runId)
        if (commandType === 'emergency_stop') await cancelEmployeeRun(runId)
        affectedRunIds.push(runId)
        const card = snapshot.cards.find((item) => item.employeeRunId === runId)
        if (card) affectedAgentIds.add(card.agentProfileId)
      } catch {
        skippedRunIds.push(runId)
      }
    }
  } else {
    snapshot.cards.forEach((card) => affectedAgentIds.add(card.agentProfileId))
  }

  const exportManifest =
    commandType === 'export_report'
      ? {
          format: 'json',
          exportedAt: Date.now(),
          snapshotId,
          agentCount: snapshot.cards.length,
          activeRunCount: snapshot.activeRunCount,
          waitingApprovalCount: snapshot.waitingApprovalCount,
          blackboardItemCount: snapshot.blackboardItems.length,
          files: [{ path: 'agent-team-dashboard-report.json', contentType: 'application/json' }],
        }
      : {}
  if (commandType === 'export_report') {
    await db
      .update(schema.agentTeamDashboardSnapshots)
      .set({ status: 'exported', exportManifest })
      .where(eq(schema.agentTeamDashboardSnapshots.id, snapshotId))
  }

  const row: AgentTeamDashboardCommandRow = {
    id: newAgentTeamDashboardCommandId(),
    dashboardSnapshotId: snapshotId,
    commandType,
    status: commandStatus(commandType, targetRunIds, affectedRunIds, skippedRunIds),
    affectedAgentProfileIds: [...affectedAgentIds],
    affectedEmployeeRunIds: affectedRunIds,
    skippedEmployeeRunIds: skippedRunIds,
    summary: buildCommandSummary(commandType, targetRunIds.length, affectedRunIds.length, skippedRunIds.length),
    exportManifest,
    createdAt: Date.now(),
  }
  await db.insert(schema.agentTeamDashboardCommands).values(row)
  return row
}

export async function listAgentTeamDashboardCommands(args: {
  dashboardSnapshotId?: string
  commandType?: AgentTeamDashboardCommandType
  limit?: number
} = {}): Promise<AgentTeamDashboardCommandRow[]> {
  const conditions: SQL[] = []
  if (args.dashboardSnapshotId) {
    conditions.push(eq(schema.agentTeamDashboardCommands.dashboardSnapshotId, args.dashboardSnapshotId))
  }
  if (args.commandType) {
    conditions.push(eq(schema.agentTeamDashboardCommands.commandType, args.commandType))
  }
  return db.query.agentTeamDashboardCommands.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.agentTeamDashboardCommands.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function getRequiredSnapshot(id: string): Promise<AgentTeamDashboardSnapshotRow> {
  const row = await db.query.agentTeamDashboardSnapshots.findFirst({
    where: eq(schema.agentTeamDashboardSnapshots.id, id),
  })
  if (!row) throw new Error(`Agent team dashboard snapshot not found: ${id}`)
  return row
}

async function resolveAgents(agentProfileIds: string[]): Promise<AgentProfileRow[]> {
  const normalized = agentProfileIds.map((id) => id.trim()).filter(Boolean)
  if (normalized.length > 0) {
    return db.query.agentProfiles.findMany({
      where: inArray(schema.agentProfiles.id, normalized),
      orderBy: [desc(schema.agentProfiles.updatedAt)],
    })
  }
  return db.query.agentProfiles.findMany({
    where: eq(schema.agentProfiles.status, 'active'),
    orderBy: [desc(schema.agentProfiles.updatedAt)],
    limit: 12,
  })
}

function latestRunForAgent(
  runs: EmployeeRunRow[],
  agentProfileId: string,
  workflowRunId?: string | null,
): EmployeeRunRow | null {
  return (
    runs.find((run) => {
      if (run.agentProfileId !== agentProfileId) return false
      if (workflowRunId && run.workflowRunId !== workflowRunId) return false
      return true
    }) ?? null
  )
}

function buildAgentCard(args: {
  agent: AgentProfileRow
  run: EmployeeRunRow | null
  events: EmployeeRunEventRow[]
  pendingApprovals: { runId: string | null }[]
  computerSessionIds: string[]
}): AgentTeamDashboardCard {
  const runEvents = args.run
    ? args.events.filter((event) => event.employeeRunId === args.run?.id)
    : []
  const latestEvent = runEvents[0] ?? null
  const waitingApprovalCount = args.run
    ? args.pendingApprovals.filter((approval) => !approval.runId || approval.runId === args.run?.id).length
    : args.pendingApprovals.length
  const status = mapCardStatus(args.run, waitingApprovalCount)
  return {
    agentProfileId: args.agent.id,
    agentName: args.agent.name,
    role: args.agent.role,
    status,
    employeeRunId: args.run?.id ?? null,
    goal: args.run?.goal ?? '',
    currentPhase: args.run?.currentPhase ?? 'idle',
    currentStep: args.run?.currentStep ?? latestEvent?.message ?? 'Idle',
    stepIndex: args.run ? Math.min(args.run.plan.length || runEvents.length, runEvents.length) : 0,
    stepTotal: args.run ? Math.max(args.run.plan.length, runEvents.length, 1) : 0,
    lastEventAt: latestEvent?.createdAt ?? args.run?.updatedAt ?? null,
    waitingApprovalCount,
    computerSessionIds: args.computerSessionIds,
    canViewScreen: args.computerSessionIds.length > 0,
    canHelp: ['waiting_approval', 'blocked', 'failed'].includes(status),
    canTakeOver: ['working', 'waiting_approval', 'blocked', 'paused'].includes(status),
    error: args.run?.error ?? null,
  }
}

function mapCardStatus(
  run: EmployeeRunRow | null,
  waitingApprovalCount: number,
): AgentTeamDashboardCard['status'] {
  if (!run) return 'idle'
  if (waitingApprovalCount > 0) return 'waiting_approval'
  if (run.status === 'queued' || run.status === 'running') return 'working'
  if (run.status === 'paused') return 'paused'
  if (run.status === 'complete') return 'complete'
  if (run.status === 'failed') return 'failed'
  return 'blocked'
}

function targetRunIdsForCommand(
  cards: AgentTeamDashboardCard[],
  commandType: AgentTeamDashboardCommandType,
): string[] {
  if (commandType === 'pause_all') {
    return cards
      .filter((card) => card.employeeRunId && ['working', 'waiting_approval'].includes(card.status))
      .map((card) => card.employeeRunId as string)
  }
  if (commandType === 'resume_all') {
    return cards
      .filter((card) => card.employeeRunId && card.status === 'paused')
      .map((card) => card.employeeRunId as string)
  }
  if (commandType === 'emergency_stop') {
    return cards
      .filter((card) => card.employeeRunId && !['complete', 'failed'].includes(card.status))
      .map((card) => card.employeeRunId as string)
  }
  return []
}

function commandStatus(
  commandType: AgentTeamDashboardCommandType,
  targetRunIds: string[],
  affectedRunIds: string[],
  skippedRunIds: string[],
): AgentTeamDashboardCommandRow['status'] {
  if (commandType === 'export_report') return 'applied'
  if (targetRunIds.length === 0) return 'skipped'
  if (affectedRunIds.length === targetRunIds.length) return 'applied'
  if (affectedRunIds.length > 0 || skippedRunIds.length > 0) return 'partially_applied'
  return 'planned'
}

function buildDashboardSummary(cards: AgentTeamDashboardCard[]): string {
  const working = cards.filter((card) => card.status === 'working').length
  const approvals = cards.reduce((sum, card) => sum + card.waitingApprovalCount, 0)
  const failed = cards.filter((card) => card.status === 'failed').length
  return `${cards.length} Agents visible; ${working} working, ${approvals} approvals waiting, ${failed} failed.`
}

function buildCommandSummary(
  commandType: AgentTeamDashboardCommandType,
  targetCount: number,
  affectedCount: number,
  skippedCount: number,
): string {
  if (commandType === 'export_report') return 'Dashboard report export manifest generated.'
  return `${commandType} targeted ${targetCount} runs; ${affectedCount} affected and ${skippedCount} skipped.`
}

function summarizeJson(value: JsonObject): string {
  const summary = getString(value, 'message') ?? getString(value, 'text') ?? JSON.stringify(value)
  return summary.length > 160 ? `${summary.slice(0, 157)}...` : summary
}

function getString(value: JsonObject, key: string): string | null {
  const next = value[key]
  return typeof next === 'string' && next.trim() ? next.trim() : null
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
