import { and, asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentHealthScoreRow,
  AlertComparison,
  AlertEventRow,
  AlertRuleRow,
  DebugReplaySnapshotRow,
  EmployeeRunRow,
  JsonObject,
  MetricPointRow,
  NotificationLevel,
} from '@/db/schema'
import {
  newAgentHealthScoreId,
  newAlertEventId,
  newAlertRuleId,
  newDebugReplaySnapshotId,
  newMetricPointId,
} from '@/server/ids'
import { createNotification } from '@/server/notification-service'
import { recordAuditLog } from '@/server/security-service'

export interface RecordMetricPointArgs {
  metricName: string
  value: number
  unit?: string
  resourceType?: string | null
  resourceId?: string | null
  tags?: JsonObject
}

export async function recordMetricPoint(args: RecordMetricPointArgs): Promise<{
  metricPoint: MetricPointRow
  alertEvents: AlertEventRow[]
}> {
  const metricPoint: MetricPointRow = {
    id: newMetricPointId(),
    metricName: normalizeRequired(args.metricName, 'metricName'),
    resourceType: normalizeNullable(args.resourceType),
    resourceId: normalizeNullable(args.resourceId),
    value: args.value,
    unit: args.unit?.trim() || 'count',
    tags: args.tags ?? {},
    createdAt: Date.now(),
  }
  await db.insert(schema.metricPoints).values(metricPoint)
  const alertEvents = await evaluateMetricPointAlerts(metricPoint)
  return { metricPoint, alertEvents }
}

export async function listMetricPoints(metricName?: string): Promise<MetricPointRow[]> {
  return db.query.metricPoints.findMany({
    where: metricName ? eq(schema.metricPoints.metricName, metricName) : undefined,
    orderBy: [desc(schema.metricPoints.createdAt)],
    limit: 100,
  })
}

export interface CreateAlertRuleArgs {
  name: string
  metricName: string
  comparison?: AlertComparison
  threshold: number
  severity?: NotificationLevel
  enabled?: boolean
  cooldownMs?: number
}

export async function createAlertRule(args: CreateAlertRuleArgs): Promise<AlertRuleRow> {
  const now = Date.now()
  const row: AlertRuleRow = {
    id: newAlertRuleId(),
    name: normalizeRequired(args.name, 'name'),
    metricName: normalizeRequired(args.metricName, 'metricName'),
    comparison: args.comparison ?? 'gte',
    threshold: args.threshold,
    severity: args.severity ?? 'warning',
    enabled: args.enabled ?? true,
    cooldownMs: args.cooldownMs ?? 300000,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.alertRules).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'observability.alert_rule.create',
    resourceType: 'alert_rule',
    resourceId: row.id,
    riskLevel: row.severity === 'critical' ? 'high' : 'low',
    message: `Alert rule ${row.name} was created.`,
    metadata: { metricName: row.metricName, threshold: row.threshold, comparison: row.comparison },
  })
  return row
}

export async function listAlertRules(): Promise<AlertRuleRow[]> {
  return db.query.alertRules.findMany({ orderBy: [desc(schema.alertRules.createdAt)] })
}

export async function listAlertEvents(status?: AlertEventRow['status']): Promise<AlertEventRow[]> {
  return db.query.alertEvents.findMany({
    where: status ? eq(schema.alertEvents.status, status) : undefined,
    orderBy: [desc(schema.alertEvents.createdAt)],
    limit: 100,
  })
}

export async function createDebugReplaySnapshotForEmployeeRun(
  employeeRunId: string,
): Promise<DebugReplaySnapshotRow> {
  const debugPackage = await buildEmployeeRunDebugPackage(employeeRunId)
  const run = await db.query.employeeRuns.findFirst({
    where: eq(schema.employeeRuns.id, employeeRunId),
  })
  if (!run) throw new Error(`Employee run not found: ${employeeRunId}`)
  const events = await db.query.employeeRunEvents.findMany({
    where: eq(schema.employeeRunEvents.employeeRunId, employeeRunId),
    orderBy: [asc(schema.employeeRunEvents.createdAt)],
  })
  const latestCheckpoint =
    (await db.query.runtimeCheckpoints.findFirst({
      where: eq(schema.runtimeCheckpoints.employeeRunId, employeeRunId),
      orderBy: [desc(schema.runtimeCheckpoints.stepIndex)],
    })) ?? null
  const contextSnapshots = await db.query.runtimeContextSnapshots.findMany({
    where: eq(schema.runtimeContextSnapshots.employeeRunId, employeeRunId),
    orderBy: [asc(schema.runtimeContextSnapshots.createdAt)],
  })
  const debugPanel = buildDebugPanelState(run, debugPackage)
  const replay: DebugReplaySnapshotRow = {
    id: newDebugReplaySnapshotId(),
    resourceType: 'employee_run',
    resourceId: employeeRunId,
    summary: `Replay for ${employeeRunId}: ${events.length} events, checkpoint ${latestCheckpoint?.phase ?? 'none'}.`,
    eventCount: events.length,
    checkpointId: latestCheckpoint?.id ?? null,
    payload: {
      runStatus: run.status,
      currentPhase: run.currentPhase,
      eventPhases: events.map((event) => event.phase),
      contextSnapshotIds: contextSnapshots.map((snapshot) => snapshot.id),
      latestCheckpointState: latestCheckpoint?.state ?? null,
      debugPanel,
      debugPackageManifest: manifestWithoutContent(debugPackage),
    },
    createdAt: Date.now(),
  }
  await db.insert(schema.debugReplaySnapshots).values(replay)
  await recordAuditLog({
    actorType: 'system',
    action: 'observability.debug_replay.create',
    resourceType: 'employee_run',
    resourceId: employeeRunId,
    message: replay.summary,
    metadata: { debugReplaySnapshotId: replay.id },
  })
  return replay
}

export interface AgentDebugPackageFile {
  path: string
  contentType: string
  bytes: number
  content: string
}

export interface EmployeeRunDebugPackage {
  fileName: string
  generatedAt: number
  resourceType: 'employee_run'
  resourceId: string
  diagnostics: JsonObject
  files: AgentDebugPackageFile[]
}

export async function buildEmployeeRunDebugPackage(
  employeeRunId: string,
): Promise<EmployeeRunDebugPackage> {
  const run = await getRequiredEmployeeRun(employeeRunId)
  const agentProfile = await db.query.agentProfiles.findFirst({
    where: eq(schema.agentProfiles.id, run.agentProfileId),
  })
  const [
    events,
    checkpoints,
    contextSnapshots,
    cliRuns,
    mcpToolCalls,
    computerSessions,
    computerActionEvents,
    artifactValidations,
    decisionAuditTrails,
    budgetEvents,
    recoveryEvents,
    resourceLocks,
    memoryItems,
  ] = await Promise.all([
    db.query.employeeRunEvents.findMany({
      where: eq(schema.employeeRunEvents.employeeRunId, employeeRunId),
      orderBy: [asc(schema.employeeRunEvents.createdAt)],
    }),
    db.query.runtimeCheckpoints.findMany({
      where: eq(schema.runtimeCheckpoints.employeeRunId, employeeRunId),
      orderBy: [asc(schema.runtimeCheckpoints.stepIndex)],
    }),
    db.query.runtimeContextSnapshots.findMany({
      where: eq(schema.runtimeContextSnapshots.employeeRunId, employeeRunId),
      orderBy: [asc(schema.runtimeContextSnapshots.createdAt)],
    }),
    db.query.cliRuns.findMany({
      where: eq(schema.cliRuns.employeeRunId, employeeRunId),
      orderBy: [asc(schema.cliRuns.createdAt)],
    }),
    db.query.mcpToolCalls.findMany({
      where: eq(schema.mcpToolCalls.employeeRunId, employeeRunId),
      orderBy: [asc(schema.mcpToolCalls.createdAt)],
    }),
    db.query.computerSessions.findMany({
      where: eq(schema.computerSessions.employeeRunId, employeeRunId),
      orderBy: [asc(schema.computerSessions.createdAt)],
    }),
    db.query.computerActionEvents.findMany({
      where: eq(schema.computerActionEvents.employeeRunId, employeeRunId),
      orderBy: [asc(schema.computerActionEvents.createdAt)],
    }),
    db.query.artifactValidations.findMany({
      where: eq(schema.artifactValidations.runId, employeeRunId),
      orderBy: [asc(schema.artifactValidations.createdAt)],
    }),
    db.query.decisionAuditTrails.findMany({
      where: eq(schema.decisionAuditTrails.employeeRunId, employeeRunId),
      orderBy: [asc(schema.decisionAuditTrails.createdAt)],
    }),
    db.query.budgetEvents.findMany({
      where: eq(schema.budgetEvents.employeeRunId, employeeRunId),
      orderBy: [asc(schema.budgetEvents.createdAt)],
    }),
    db.query.recoveryEvents.findMany({
      where: and(
        eq(schema.recoveryEvents.resourceType, 'employee_run'),
        eq(schema.recoveryEvents.resourceId, employeeRunId),
      ),
      orderBy: [asc(schema.recoveryEvents.createdAt)],
    }),
    db.query.resourceLocks.findMany({
      where: eq(schema.resourceLocks.ownerRunId, employeeRunId),
      orderBy: [asc(schema.resourceLocks.createdAt)],
    }),
    db.query.memoryItems.findMany({
      where: eq(schema.memoryItems.sourceRunId, employeeRunId),
      orderBy: [asc(schema.memoryItems.createdAt)],
    }),
  ])
  const latestContext = contextSnapshots.at(-1) ?? null
  const diagnostics: JsonObject = {
    generatedAt: Date.now(),
    runStatus: run.status,
    currentPhase: run.currentPhase,
    eventCount: events.length,
    checkpointCount: checkpoints.length,
    contextSnapshotCount: contextSnapshots.length,
    activeMemoryItems: memoryItems.length,
    heldLocks: resourceLocks.filter((lock) => lock.status === 'held').length,
    cliRunCount: cliRuns.length,
    mcpToolCallCount: mcpToolCalls.length,
    computerSessionCount: computerSessions.length,
    computerActionCount: computerActionEvents.length,
    artifactValidationCount: artifactValidations.length,
    decisionCount: decisionAuditTrails.length,
    tokenEstimate: latestContext?.tokenEstimate ?? 0,
    tokenBudget: latestContext?.tokenBudget ?? null,
    nextStepSimulation: simulateNextDebugStep(run, events.map((event) => event.phase)),
  }
  const runSummary = {
    run,
    agentProfile: agentProfile
      ? {
          id: agentProfile.id,
          name: agentProfile.name,
          role: agentProfile.role,
          status: agentProfile.status,
          modelProfileId: agentProfile.modelProfileId,
          skillIds: agentProfile.skillIds,
          cliProfileIds: agentProfile.cliProfileIds,
          mcpServerIds: agentProfile.mcpServerIds,
          softwareProfileIds: agentProfile.softwareProfileIds,
        }
      : null,
    diagnostics,
  }
  const toolCalls = [
    ...cliRuns.map((row) => ({ kind: 'cli', ...row })),
    ...mcpToolCalls.map((row) => ({ kind: 'mcp', ...row })),
    ...computerActionEvents.map((row) => ({ kind: 'computer_action', ...row })),
  ]
  const screenshots = computerActionEvents
    .map((event) => ({
      eventId: event.id,
      actionType: event.actionType,
      screenshotPath: getString(event.output, 'screenshotPath') ?? getString(event.input, 'screenshotPath'),
      pageUrl: getString(event.output, 'pageUrl') ?? getString(event.input, 'pageUrl'),
      createdAt: event.createdAt,
    }))
    .filter((entry) => entry.screenshotPath || entry.pageUrl)
  const files = [
    jsonFile('run_summary.json', runSummary),
    jsonlFile('events.jsonl', events),
    jsonlFile('prompts/context_snapshots.jsonl', contextSnapshots),
    jsonFile('prompts/last_prompt.json', latestContext?.visibleContext ?? {}),
    jsonFile('responses/run_output.json', {
      status: run.status,
      output: run.output,
      error: run.error,
      finishedAt: run.finishedAt,
    }),
    jsonlFile('tool_calls/tool_calls.jsonl', toolCalls),
    jsonlFile('tool_calls/cli_runs.jsonl', cliRuns),
    jsonlFile('tool_calls/mcp_tool_calls.jsonl', mcpToolCalls),
    jsonlFile('tool_calls/computer_actions.jsonl', computerActionEvents),
    jsonlFile('snapshots/checkpoints.jsonl', checkpoints),
    jsonlFile('snapshots/context_snapshots.jsonl', contextSnapshots),
    jsonFile('snapshots/screenshots.json', { screenshots }),
    jsonFile('workspace_diff/manifest.json', {
      available: false,
      reason: 'File-level workspace diff export is not attached to deterministic local runtime yet.',
      computerSessionWorkspaces: computerSessions.map((session) => session.workspacePath),
    }),
    jsonlFile('diagnostics/decision_audit.jsonl', decisionAuditTrails),
    jsonlFile('diagnostics/artifact_validations.jsonl', artifactValidations),
    jsonlFile('diagnostics/budget_events.jsonl', budgetEvents),
    jsonlFile('diagnostics/recovery_events.jsonl', recoveryEvents),
    jsonlFile('diagnostics/resource_locks.jsonl', resourceLocks),
    jsonlFile('diagnostics/memory_items.jsonl', memoryItems),
    jsonFile('diagnostics.json', diagnostics),
  ]
  const manifest = {
    fileName: `agent-debug-${employeeRunId}.zip`,
    generatedAt: Number(diagnostics.generatedAt),
    resourceType: 'employee_run' as const,
    resourceId: employeeRunId,
    diagnostics,
    files,
  }
  return manifest
}

export async function listDebugReplaySnapshots(
  resourceType?: string,
  resourceId?: string,
): Promise<DebugReplaySnapshotRow[]> {
  const where =
    resourceType && resourceId
      ? and(
          eq(schema.debugReplaySnapshots.resourceType, resourceType),
          eq(schema.debugReplaySnapshots.resourceId, resourceId),
        )
      : undefined
  return db.query.debugReplaySnapshots.findMany({
    where,
    orderBy: [desc(schema.debugReplaySnapshots.createdAt)],
    limit: 100,
  })
}

export async function computeAgentHealthScore(
  agentProfileId: string,
): Promise<AgentHealthScoreRow> {
  const runs = await db.query.employeeRuns.findMany({
    where: eq(schema.employeeRuns.agentProfileId, agentProfileId),
  })
  const runCount = runs.length
  const completed = runs.filter((run) => run.status === 'complete').length
  const failed = runs.filter((run) => run.status === 'failed' || run.status === 'aborted').length
  const approvals = await db.query.approvalRequests.findMany({
    where: eq(schema.approvalRequests.agentProfileId, agentProfileId),
  })
  const recoveryEvents = await db.query.recoveryEvents.findMany({
    where: eq(schema.recoveryEvents.resourceType, 'employee_run'),
  })
  const agentRunIds = new Set(runs.map((run) => run.id))
  const agentRecoveryEvents = recoveryEvents.filter((event) => agentRunIds.has(event.resourceId))
  const successRate = runCount ? completed / runCount : 0
  const failureRate = runCount ? failed / runCount : 0
  const approvalRate = runCount ? approvals.length / runCount : 0
  const selfRecoveryRate = runCount ? agentRecoveryEvents.length / runCount : 0
  const score = clampScore(
    100 * successRate -
      35 * failureRate -
      10 * Math.min(approvalRate, 1) +
      5 * Math.min(selfRecoveryRate, 1),
  )
  const row: AgentHealthScoreRow = {
    id: newAgentHealthScoreId(),
    agentProfileId,
    runCount,
    successRate,
    failureRate,
    approvalRate,
    selfRecoveryRate,
    score,
    computedAt: Date.now(),
  }
  await db.insert(schema.agentHealthScores).values(row)
  return row
}

export async function listAgentHealthScores(agentProfileId?: string): Promise<AgentHealthScoreRow[]> {
  return db.query.agentHealthScores.findMany({
    where: agentProfileId ? eq(schema.agentHealthScores.agentProfileId, agentProfileId) : undefined,
    orderBy: [desc(schema.agentHealthScores.computedAt)],
    limit: 100,
  })
}

async function evaluateMetricPointAlerts(metricPoint: MetricPointRow): Promise<AlertEventRow[]> {
  const rules = await db.query.alertRules.findMany({
    where: and(
      eq(schema.alertRules.metricName, metricPoint.metricName),
      eq(schema.alertRules.enabled, true),
    ),
  })
  const events: AlertEventRow[] = []
  for (const rule of rules) {
    if (!matchesRule(metricPoint.value, rule.comparison, rule.threshold)) continue
    const event: AlertEventRow = {
      id: newAlertEventId(),
      alertRuleId: rule.id,
      metricPointId: metricPoint.id,
      resourceType: metricPoint.resourceType,
      resourceId: metricPoint.resourceId,
      status: 'open',
      severity: rule.severity,
      message: `${rule.name}: ${metricPoint.metricName} ${rule.comparison} ${rule.threshold} (${metricPoint.value} ${metricPoint.unit}).`,
      createdAt: Date.now(),
      resolvedAt: null,
    }
    await db.insert(schema.alertEvents).values(event)
    await createNotification({
      channel: 'in_app',
      level: rule.severity,
      sourceType: 'alert_event',
      sourceId: event.id,
      title: `Alert: ${rule.name}`,
      message: event.message,
      payload: { metricPointId: metricPoint.id, alertRuleId: rule.id },
    })
    events.push(event)
  }
  return events
}

function matchesRule(value: number, comparison: AlertComparison, threshold: number): boolean {
  if (comparison === 'gt') return value > threshold
  if (comparison === 'gte') return value >= threshold
  if (comparison === 'lt') return value < threshold
  if (comparison === 'lte') return value <= threshold
  return value === threshold
}

function buildDebugPanelState(run: EmployeeRunRow, debugPackage: EmployeeRunDebugPackage): JsonObject {
  const diagnostics = debugPackage.diagnostics
  const tokenEstimate = getNumber(diagnostics, 'tokenEstimate')
  const tokenBudget = getNumber(diagnostics, 'tokenBudget')
  return {
    agentDebugPanel: true,
    currentState: {
      runId: run.id,
      status: run.status,
      currentPhase: run.currentPhase,
      step: {
        current: getNumber(diagnostics, 'checkpointCount') ?? 0,
        total: Math.max(run.plan.length, getNumber(diagnostics, 'checkpointCount') ?? 0),
      },
      contextTokens: {
        used: tokenEstimate ?? 0,
        budget: tokenBudget,
        percent: tokenBudget ? Math.round(((tokenEstimate ?? 0) / tokenBudget) * 100) : null,
      },
      currentPlanConfidence: estimatePlanConfidence(run),
      activeMemoryItems: getNumber(diagnostics, 'activeMemoryItems') ?? 0,
      heldLocks: getNumber(diagnostics, 'heldLocks') ?? 0,
    },
    modelCallHistory: debugPackage.files
      .filter((file) => file.path.startsWith('prompts/'))
      .slice(-5)
      .map((file) => ({
        purpose: file.path,
        promptRef: file.path,
        responseRef: 'responses/run_output.json',
        latencyMs: null,
        estimatedCostCents: null,
      })),
    manualActions: [
      {
        action: 'inject_prompt',
        status: 'guarded_preview',
        riskLevel: 'high',
        reason: 'Prompt injection is represented in the debug package and requires a future explicit approval path before mutating a run.',
      },
      {
        action: 'skip_current_step',
        status: run.status === 'running' ? 'requires_approval' : 'unavailable',
        riskLevel: 'medium',
        reason: 'Skipping is only safe for active runs and must be approval-gated.',
      },
      {
        action: 'force_retry',
        status: run.status === 'failed' ? 'requires_approval' : 'simulated_only',
        riskLevel: 'medium',
        reason: 'Retry simulation is available; live retry is handled by recovery/queue primitives.',
      },
      {
        action: 'export_debug_package',
        status: 'available',
        riskLevel: 'low',
        fileName: debugPackage.fileName,
      },
      {
        action: 'simulate_next_step',
        status: 'available',
        riskLevel: 'low',
        result: simulateNextDebugStep(run, []),
      },
    ],
  }
}

function simulateNextDebugStep(run: EmployeeRunRow, eventPhases: string[]): JsonObject {
  if (run.status === 'complete') {
    return {
      nextStep: 'review_artifact_and_learning',
      reason: 'The run is complete; inspect artifacts, validations, memory updates, and reflection before reuse.',
    }
  }
  if (run.status === 'failed' || run.status === 'aborted') {
    return {
      nextStep: 'recover_from_last_checkpoint',
      reason: 'The run did not complete; use checkpoints, recovery events, and decision audit before retrying.',
    }
  }
  const lastPhase = eventPhases.at(-1) ?? run.currentPhase
  return {
    nextStep: lastPhase === 'retrieve_memory' ? 'create_plan' : 'continue_runtime_loop',
    reason: `Last observed phase is ${lastPhase}.`,
  }
}

function estimatePlanConfidence(run: EmployeeRunRow): number {
  if (run.status === 'complete') return 0.95
  if (run.status === 'failed' || run.status === 'aborted') return 0.3
  if (run.status === 'running') return 0.72
  return 0.5
}

function manifestWithoutContent(debugPackage: EmployeeRunDebugPackage): JsonObject {
  return {
    fileName: debugPackage.fileName,
    generatedAt: debugPackage.generatedAt,
    resourceType: debugPackage.resourceType,
    resourceId: debugPackage.resourceId,
    diagnostics: debugPackage.diagnostics,
    files: debugPackage.files.map((file) => ({
      path: file.path,
      contentType: file.contentType,
      bytes: file.bytes,
    })),
  }
}

function jsonFile(path: string, value: unknown): AgentDebugPackageFile {
  return textFile(path, 'application/json', `${JSON.stringify(value, null, 2)}\n`)
}

function jsonlFile(path: string, rows: unknown[]): AgentDebugPackageFile {
  const content = rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : ''
  return textFile(path, 'application/x-jsonlines', content)
}

function textFile(path: string, contentType: string, content: string): AgentDebugPackageFile {
  return {
    path,
    contentType,
    content,
    bytes: Buffer.byteLength(content, 'utf8'),
  }
}

async function getRequiredEmployeeRun(employeeRunId: string): Promise<EmployeeRunRow> {
  const run = await db.query.employeeRuns.findFirst({
    where: eq(schema.employeeRuns.id, employeeRunId),
  })
  if (!run) throw new Error(`Employee run not found: ${employeeRunId}`)
  return run
}

function getString(obj: JsonObject | null | undefined, key: string): string | null {
  const value = obj?.[key]
  return typeof value === 'string' ? value : null
}

function getNumber(obj: JsonObject | null | undefined, key: string): number | null {
  const value = obj?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
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
