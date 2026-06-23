import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  BacktestGateStatus,
  BacktestRunMode,
  BacktestRunRow,
  GoldenTaskSetRow,
  GoldenTaskSetStatus,
  JsonObject,
  SimulationRunMode,
  SimulationRunRow,
  SimulationRunStatus,
  SimulationTargetType,
  WorkflowNodeRow,
  WorkflowRow,
} from '@/db/schema'
import { newBacktestRunId, newGoldenTaskSetId, newSimulationRunId } from '@/server/ids'

export interface SimulationTask {
  id?: string
  title: string
  input?: JsonObject
  successCriteria?: string[]
  environmentSnapshot?: JsonObject
}

export interface CreateSimulationRunArgs {
  targetType: SimulationTargetType
  agentProfileId?: string | null
  workflowId?: string | null
  mode?: SimulationRunMode
  taskTitle: string
  input?: JsonObject
  simulatedEnvironment?: JsonObject
  simulatedToolResults?: JsonObject[]
}

export interface ReviewSimulationRunArgs {
  decision: Extract<SimulationRunStatus, 'approved' | 'rejected'>
  adjustments?: JsonObject[]
}

export interface CreateGoldenTaskSetArgs {
  name: string
  targetType?: SimulationTargetType
  agentProfileId?: string | null
  workflowId?: string | null
  tasks: SimulationTask[]
  successCriteria?: string[]
  ciPolicy?: JsonObject
  status?: GoldenTaskSetStatus
}

export interface RunBacktestArgs {
  mode?: BacktestRunMode
  targetType: SimulationTargetType
  agentProfileId?: string | null
  workflowId?: string | null
  goldenTaskSetId?: string | null
  historicalTasks?: SimulationTask[]
  baselineVersion?: string
  candidateVersion?: string
  candidateChanges?: JsonObject
}

export async function createSimulationRun(args: CreateSimulationRunArgs): Promise<SimulationRunRow> {
  const target = await getSimulationTarget(args)
  const now = Date.now()
  const simulatedEnvironment = buildSimulatedEnvironment(args, target)
  const simulatedToolResults = args.simulatedToolResults ?? []
  const plannedSteps = buildPlannedSteps(args, target, simulatedToolResults)
  const estimatedCostCents = Math.max(1, plannedSteps.length * 2 + simulatedToolResults.length)
  const row: SimulationRunRow = {
    id: newSimulationRunId(),
    targetType: args.targetType,
    agentProfileId: target.agent?.id ?? null,
    workflowId: target.workflow?.id ?? null,
    mode: args.mode ?? 'dry_run',
    status: 'awaiting_review',
    taskTitle: args.taskTitle.trim(),
    input: args.input ?? {},
    simulatedEnvironment,
    simulatedToolResults,
    plannedSteps,
    reviewAdjustments: [],
    estimatedCostCents,
    estimatedDurationMs: plannedSteps.length * 12000,
    approvalSummary: {
      requiresUserConfirmation: true,
      reason: 'Simulation runs never mutate real files, browsers, or external tools; approval is required before live execution.',
      targetLabel: target.label,
      reviewOptions: ['approve', 'reject', 'adjust_plan'],
    },
    createdAt: now,
    reviewedAt: null,
  }
  await db.insert(schema.simulationRuns).values(row)
  return row
}

export async function reviewSimulationRun(
  id: string,
  args: ReviewSimulationRunArgs,
): Promise<SimulationRunRow> {
  const run = await getRequiredSimulationRun(id)
  const adjustments = args.adjustments ?? []
  await db
    .update(schema.simulationRuns)
    .set({
      status: args.decision,
      reviewAdjustments: mergeAdjustments(run.reviewAdjustments, adjustments),
      reviewedAt: Date.now(),
    })
    .where(eq(schema.simulationRuns.id, id))
  return getRequiredSimulationRun(id)
}

export async function listSimulationRuns(args: {
  agentProfileId?: string
  workflowId?: string
  status?: SimulationRunStatus
  limit?: number
} = {}): Promise<SimulationRunRow[]> {
  const filters: SQL[] = []
  if (args.agentProfileId) filters.push(eq(schema.simulationRuns.agentProfileId, args.agentProfileId))
  if (args.workflowId) filters.push(eq(schema.simulationRuns.workflowId, args.workflowId))
  if (args.status) filters.push(eq(schema.simulationRuns.status, args.status))
  return db.query.simulationRuns.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.simulationRuns.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function createGoldenTaskSet(args: CreateGoldenTaskSetArgs): Promise<GoldenTaskSetRow> {
  if (!args.tasks.length) throw new Error('Golden task set requires at least one task.')
  const targetType = args.targetType ?? (args.workflowId ? 'workflow' : 'agent')
  const target = await getSimulationTarget({
    targetType,
    agentProfileId: args.agentProfileId,
    workflowId: args.workflowId,
    taskTitle: args.name,
  })
  const now = Date.now()
  const row: GoldenTaskSetRow = {
    id: newGoldenTaskSetId(),
    name: args.name.trim(),
    targetType,
    agentProfileId: target.agent?.id ?? null,
    workflowId: target.workflow?.id ?? null,
    tasks: normalizeTasks(args.tasks),
    successCriteria: args.successCriteria ?? collectCriteria(args.tasks),
    ciPolicy: {
      minSuccessRate: 0.75,
      maxRegression: 0,
      blockOnRegression: true,
      ...(args.ciPolicy ?? {}),
    },
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.goldenTaskSets).values(row)
  return row
}

export async function listGoldenTaskSets(args: {
  agentProfileId?: string
  workflowId?: string
  status?: GoldenTaskSetStatus
  limit?: number
} = {}): Promise<GoldenTaskSetRow[]> {
  const filters: SQL[] = []
  if (args.agentProfileId) filters.push(eq(schema.goldenTaskSets.agentProfileId, args.agentProfileId))
  if (args.workflowId) filters.push(eq(schema.goldenTaskSets.workflowId, args.workflowId))
  if (args.status) filters.push(eq(schema.goldenTaskSets.status, args.status))
  return db.query.goldenTaskSets.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.goldenTaskSets.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function runBacktest(args: RunBacktestArgs): Promise<BacktestRunRow> {
  const mode = args.mode ?? (args.goldenTaskSetId ? 'golden' : 'historical')
  const goldenTaskSet = args.goldenTaskSetId ? await getRequiredGoldenTaskSet(args.goldenTaskSetId) : null
  const targetType = args.targetType
  const target = await getSimulationTarget({
    targetType,
    agentProfileId: args.agentProfileId ?? goldenTaskSet?.agentProfileId,
    workflowId: args.workflowId ?? goldenTaskSet?.workflowId,
    taskTitle: goldenTaskSet?.name ?? 'Backtest',
  })
  const tasks = goldenTaskSet ? tasksFromJson(goldenTaskSet.tasks) : normalizeTasks(args.historicalTasks ?? [])
  if (!tasks.length) throw new Error('Backtest requires historical tasks or a golden task set.')
  const candidateChanges = args.candidateChanges ?? {}
  const results = tasks.map((task, index) => scoreBacktestTask(task, index, target, candidateChanges))
  const successRateBefore = average(
    results.map((result) => getNumber(isJsonObject(result.baseline) ? result.baseline : {}, 'score')),
  )
  const successRateAfter = average(
    results.map((result) => getNumber(isJsonObject(result.candidate) ? result.candidate : {}, 'score')),
  )
  const gateStatus = evaluateGate({
    mode,
    successRateBefore,
    successRateAfter,
    ciPolicy: goldenTaskSet?.ciPolicy ?? {},
  })
  const summary: JsonObject = {
    mode,
    targetLabel: target.label,
    taskCount: tasks.length,
    successRateBefore,
    successRateAfter,
    delta: round(successRateAfter - successRateBefore, 4),
    gateStatus,
    ciBlocking: gateStatus === 'failed' && getBoolean(goldenTaskSet?.ciPolicy ?? {}, 'blockOnRegression', true),
    conclusion:
      gateStatus === 'passed'
        ? 'Candidate improves or preserves golden/historical task performance.'
        : gateStatus === 'warning'
          ? 'Candidate needs review before rollout.'
          : 'Candidate regresses the golden/historical task set and should block rollout.',
  }
  const row: BacktestRunRow = {
    id: newBacktestRunId(),
    mode,
    targetType,
    agentProfileId: target.agent?.id ?? null,
    workflowId: target.workflow?.id ?? null,
    goldenTaskSetId: goldenTaskSet?.id ?? null,
    baselineVersion: args.baselineVersion?.trim() || 'current',
    candidateVersion: args.candidateVersion?.trim() || 'candidate',
    candidateChanges,
    tasks,
    results,
    summary,
    gateStatus,
    successRateBefore,
    successRateAfter,
    createdAt: Date.now(),
  }
  await db.insert(schema.backtestRuns).values(row)
  return row
}

export async function listBacktestRuns(args: {
  agentProfileId?: string
  workflowId?: string
  goldenTaskSetId?: string
  gateStatus?: BacktestGateStatus
  limit?: number
} = {}): Promise<BacktestRunRow[]> {
  const filters: SQL[] = []
  if (args.agentProfileId) filters.push(eq(schema.backtestRuns.agentProfileId, args.agentProfileId))
  if (args.workflowId) filters.push(eq(schema.backtestRuns.workflowId, args.workflowId))
  if (args.goldenTaskSetId) filters.push(eq(schema.backtestRuns.goldenTaskSetId, args.goldenTaskSetId))
  if (args.gateStatus) filters.push(eq(schema.backtestRuns.gateStatus, args.gateStatus))
  return db.query.backtestRuns.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.backtestRuns.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function getSimulationTarget(args: {
  targetType: SimulationTargetType
  agentProfileId?: string | null
  workflowId?: string | null
  taskTitle: string
}): Promise<{
  label: string
  agent: AgentProfileRow | null
  workflow: WorkflowRow | null
  workflowNodes: WorkflowNodeRow[]
}> {
  if (args.targetType === 'agent') {
    if (!args.agentProfileId) throw new Error('Agent simulation requires agentProfileId.')
    const agent = await db.query.agentProfiles.findFirst({
      where: eq(schema.agentProfiles.id, args.agentProfileId),
    })
    if (!agent) throw new Error(`Agent profile not found: ${args.agentProfileId}`)
    return { label: agent.name, agent, workflow: null, workflowNodes: [] }
  }

  if (!args.workflowId) throw new Error('Workflow simulation requires workflowId.')
  const [workflow, workflowNodes] = await Promise.all([
    db.query.workflows.findFirst({ where: eq(schema.workflows.id, args.workflowId) }),
    db.query.workflowNodes.findMany({ where: eq(schema.workflowNodes.workflowId, args.workflowId) }),
  ])
  if (!workflow) throw new Error(`Workflow not found: ${args.workflowId}`)
  return { label: workflow.name, agent: null, workflow, workflowNodes }
}

async function getRequiredSimulationRun(id: string): Promise<SimulationRunRow> {
  const row = await db.query.simulationRuns.findFirst({ where: eq(schema.simulationRuns.id, id) })
  if (!row) throw new Error(`Simulation run not found: ${id}`)
  return row
}

async function getRequiredGoldenTaskSet(id: string): Promise<GoldenTaskSetRow> {
  const row = await db.query.goldenTaskSets.findFirst({ where: eq(schema.goldenTaskSets.id, id) })
  if (!row) throw new Error(`Golden task set not found: ${id}`)
  return row
}

function buildSimulatedEnvironment(
  args: CreateSimulationRunArgs,
  target: Awaited<ReturnType<typeof getSimulationTarget>>,
): JsonObject {
  return {
    isolation: 'simulated_only',
    filesystem: 'snapshot_read_only',
    browser: 'mock_browser_context',
    tools: 'mock_tool_results_or_user_played_environment',
    targetLabel: target.label,
    workflowNodeCount: target.workflowNodes.length,
    ...(args.simulatedEnvironment ?? {}),
  }
}

function buildPlannedSteps(
  args: CreateSimulationRunArgs,
  target: Awaited<ReturnType<typeof getSimulationTarget>>,
  toolResults: JsonObject[],
): JsonObject[] {
  const base = [
    step('observe_simulated_environment', 'Read simulated files/browser state/tool fixtures only.'),
    step('retrieve_context_snapshot', 'Use stored Agent/workflow configuration and historical memory snapshots.'),
    step('draft_execution_plan', `Plan how to complete: ${args.taskTitle.trim()}.`),
    step('simulate_tool_calls', 'Return fixture/user-played tool results instead of mutating real resources.'),
    step('verify_success_criteria', 'Check planned output against the declared success criteria.'),
    step('await_user_review', 'Pause for approve/reject/adjust before live execution.'),
  ]
  if (target.agent) {
    base.splice(2, 0, step('agent_profile_projection', `Project Agent role: ${target.agent.role}.`))
  }
  if (target.workflow) {
    base.splice(
      2,
      0,
      ...target.workflowNodes.slice(0, 12).map((node, index) =>
        step('workflow_node_simulation', `Simulate workflow node ${index + 1}: ${node.type}.`, {
          nodeId: node.id,
          nodeType: node.type,
        }),
      ),
    )
  }
  return base.map((item, index) => ({
    ...item,
    order: index + 1,
    simulatedResult: toolResults[index] ?? null,
  }))
}

function step(action: string, description: string, extra: JsonObject = {}): JsonObject {
  return { action, description, mutatesRealWorld: false, ...extra }
}

function scoreBacktestTask(
  task: JsonObject,
  index: number,
  target: Awaited<ReturnType<typeof getSimulationTarget>>,
  candidateChanges: JsonObject,
): JsonObject {
  const baseline = clamp(
    target.agent
      ? 0.62 +
          target.agent.skillIds.length * 0.025 +
          target.agent.successCriteria.length * 0.015 +
          (target.agent.modelProfileId ? 0.04 : 0) -
          index * 0.01
      : 0.64 + target.workflowNodes.length * 0.015 - index * 0.01,
  )
  const candidate = clamp(baseline + candidateDelta(candidateChanges))
  return {
    taskId: getString(task, 'id') ?? slug(getString(task, 'title') ?? `task-${index + 1}`),
    title: getString(task, 'title') ?? `Task ${index + 1}`,
    baseline: {
      version: 'baseline',
      score: round(baseline, 4),
      status: baseline >= 0.75 ? 'passed' : 'needs_review',
    },
    candidate: {
      version: 'candidate',
      score: round(candidate, 4),
      status: candidate >= 0.75 ? 'passed' : 'needs_review',
    },
    delta: round(candidate - baseline, 4),
    comparison:
      candidate > baseline
        ? 'improved'
        : candidate === baseline
          ? 'unchanged'
          : 'regressed',
    criteria: Array.isArray(task.successCriteria) ? task.successCriteria : [],
  }
}

function candidateDelta(changes: JsonObject): number {
  let delta = 0
  if (getBoolean(changes, 'promptImproved', false)) delta += 0.05
  if (getBoolean(changes, 'memoryPolicyImproved', false)) delta += 0.025
  if (getBoolean(changes, 'stricterOutputContract', false)) delta += 0.02
  if (getBoolean(changes, 'riskyAutonomyIncrease', false)) delta -= 0.06
  if (getBoolean(changes, 'expectedRegression', false)) delta -= 0.18
  const addedSkillIds = Array.isArray(changes.addedSkillIds) ? changes.addedSkillIds.length : 0
  const removedSkillIds = Array.isArray(changes.removedSkillIds) ? changes.removedSkillIds.length : 0
  delta += Math.min(addedSkillIds, 5) * 0.025
  delta -= Math.min(removedSkillIds, 5) * 0.04
  return delta
}

function evaluateGate(args: {
  mode: BacktestRunMode
  successRateBefore: number
  successRateAfter: number
  ciPolicy: JsonObject
}): BacktestGateStatus {
  const minSuccessRate = getNumber(args.ciPolicy, 'minSuccessRate', args.mode === 'golden' ? 0.75 : 0.7)
  const maxRegression = getNumber(args.ciPolicy, 'maxRegression', 0)
  if (args.successRateAfter < minSuccessRate) return 'failed'
  if (args.successRateAfter + maxRegression < args.successRateBefore) return 'failed'
  if (args.successRateAfter <= args.successRateBefore) return 'warning'
  return 'passed'
}

function normalizeTasks(tasks: SimulationTask[]): JsonObject[] {
  return tasks.map((task, index) => ({
    id: task.id?.trim() || slug(task.title) || `task-${index + 1}`,
    title: task.title.trim(),
    input: task.input ?? {},
    successCriteria: task.successCriteria ?? [],
    environmentSnapshot: task.environmentSnapshot ?? { source: 'provided_snapshot' },
  }))
}

function tasksFromJson(tasks: JsonObject[]): JsonObject[] {
  return tasks.map((task, index) => ({
    id: getString(task, 'id') ?? `task-${index + 1}`,
    title: getString(task, 'title') ?? `Task ${index + 1}`,
    input: isJsonObject(task.input) ? task.input : {},
    successCriteria: Array.isArray(task.successCriteria) ? task.successCriteria : [],
    environmentSnapshot: isJsonObject(task.environmentSnapshot) ? task.environmentSnapshot : {},
  }))
}

function collectCriteria(tasks: SimulationTask[]): string[] {
  return unique(tasks.flatMap((task) => task.successCriteria ?? []))
}

function mergeAdjustments(left: JsonObject[], right: JsonObject[]): JsonObject[] {
  return [...left, ...right].slice(-100)
}

function getString(value: JsonObject, key: string): string | null {
  const next = value[key]
  return typeof next === 'string' && next.trim() ? next.trim() : null
}

function getNumber(value: JsonObject, key: string, fallback = 0): number {
  const next = value[key]
  return typeof next === 'number' && Number.isFinite(next) ? next : fallback
}

function getBoolean(value: JsonObject, key: string, fallback: boolean): boolean {
  const next = value[key]
  return typeof next === 'boolean' ? next : fallback
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4)
}

function clamp(value: number): number {
  return Math.max(0, Math.min(0.99, value))
}

function round(value: number, places = 2): number {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

function slug(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
