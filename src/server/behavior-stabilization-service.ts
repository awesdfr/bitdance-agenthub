import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  BehaviorDriftAnalysisRow,
  BehaviorSnapshotKind,
  BehaviorSnapshotRow,
  BehaviorStabilizationRunRow,
  DriftResponsePolicy,
  JsonObject,
} from '@/db/schema'
import {
  newBehaviorDriftAnalysisId,
  newBehaviorSnapshotId,
  newBehaviorStabilizationRunId,
} from '@/server/ids'

export interface BehaviorMetrics {
  avgStepsPerTask: number
  avgCostPerTask: number
  approvalRequestRate: number
  typicalPlanStructure: string
  toolPreferenceOrder: string[]
  outputVerbosity: number
}

export interface StabilizationConfig {
  memoryHygiene?: boolean
  resetLearnedBehaviors?: boolean
  reAnchorToOriginalConfig?: boolean
  recalibrateWithBenchmarks?: boolean
}

export async function recordBehaviorSnapshot(args: {
  agentProfileId: string
  kind: BehaviorSnapshotKind
  schedule?: string
  baselineBehavior: BehaviorMetrics
  maxAllowedDeviation?: number
}): Promise<BehaviorSnapshotRow> {
  const now = Date.now()
  const row: BehaviorSnapshotRow = {
    id: newBehaviorSnapshotId(),
    agentProfileId: normalizeRequired(args.agentProfileId, 'agentProfileId'),
    kind: args.kind,
    schedule: args.schedule?.trim() || 'weekly',
    avgStepsPerTask: args.baselineBehavior.avgStepsPerTask,
    avgCostPerTask: args.baselineBehavior.avgCostPerTask,
    approvalRequestRate: args.baselineBehavior.approvalRequestRate,
    typicalPlanStructure: normalizeRequired(
      args.baselineBehavior.typicalPlanStructure,
      'typicalPlanStructure',
    ),
    toolPreferenceOrder: normalizeList(args.baselineBehavior.toolPreferenceOrder),
    outputVerbosity: args.baselineBehavior.outputVerbosity,
    maxAllowedDeviation: args.maxAllowedDeviation ?? 0.2,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.behaviorSnapshots).values(row)
  return row
}

export async function listBehaviorSnapshots(args: {
  agentProfileId?: string
  kind?: BehaviorSnapshotKind
  limit?: number
} = {}): Promise<BehaviorSnapshotRow[]> {
  const conditions: SQL[] = []
  if (args.agentProfileId) conditions.push(eq(schema.behaviorSnapshots.agentProfileId, args.agentProfileId))
  if (args.kind) conditions.push(eq(schema.behaviorSnapshots.kind, args.kind))
  return db.query.behaviorSnapshots.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.behaviorSnapshots.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function analyzeBehaviorDrift(args: {
  baselineSnapshotId: string
  currentSnapshotId: string
  stabilization?: StabilizationConfig
  onSignificantDrift?: DriftResponsePolicy
}): Promise<{
  analysis: BehaviorDriftAnalysisRow
  stabilizationRun: BehaviorStabilizationRunRow | null
}> {
  const baseline = await getRequiredBehaviorSnapshot(args.baselineSnapshotId)
  const current = await getRequiredBehaviorSnapshot(args.currentSnapshotId)
  if (baseline.agentProfileId !== current.agentProfileId) {
    throw new Error('Behavior snapshots belong to different agents.')
  }
  const driftedMetrics = computeDriftedMetrics(baseline, current)
  const maxDeviation = driftedMetrics.reduce(
    (max, metric) => Math.max(max, numberAt(metric.deviation)),
    0,
  )
  const severity =
    maxDeviation > baseline.maxAllowedDeviation
      ? 'significant'
      : maxDeviation > 0
        ? 'minor'
        : 'none'
  const stabilizationActions =
    severity === 'significant' ? actionsFromConfig(args.stabilization) : []
  const onSignificantDrift = args.onSignificantDrift ?? 'ask_user'
  const now = Date.now()
  const analysis: BehaviorDriftAnalysisRow = {
    id: newBehaviorDriftAnalysisId(),
    agentProfileId: baseline.agentProfileId,
    baselineSnapshotId: baseline.id,
    currentSnapshotId: current.id,
    maxDeviation,
    severity,
    driftedMetrics,
    onSignificantDrift,
    stabilizationActions,
    recommendation: recommendationFor(severity, onSignificantDrift, stabilizationActions),
    createdAt: now,
  }
  await db.insert(schema.behaviorDriftAnalyses).values(analysis)

  const stabilizationRun =
    severity === 'significant' && stabilizationActions.length
      ? await createStabilizationRun({
          driftAnalysisId: analysis.id,
          agentProfileId: analysis.agentProfileId,
          actions: stabilizationActions,
        })
      : null
  return { analysis, stabilizationRun }
}

export async function listBehaviorDriftAnalyses(args: {
  agentProfileId?: string
  severity?: BehaviorDriftAnalysisRow['severity']
  limit?: number
} = {}): Promise<BehaviorDriftAnalysisRow[]> {
  const conditions: SQL[] = []
  if (args.agentProfileId) {
    conditions.push(eq(schema.behaviorDriftAnalyses.agentProfileId, args.agentProfileId))
  }
  if (args.severity) conditions.push(eq(schema.behaviorDriftAnalyses.severity, args.severity))
  return db.query.behaviorDriftAnalyses.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.behaviorDriftAnalyses.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function listBehaviorStabilizationRuns(args: {
  agentProfileId?: string
  driftAnalysisId?: string
  status?: BehaviorStabilizationRunRow['status']
  limit?: number
} = {}): Promise<BehaviorStabilizationRunRow[]> {
  const conditions: SQL[] = []
  if (args.agentProfileId) {
    conditions.push(eq(schema.behaviorStabilizationRuns.agentProfileId, args.agentProfileId))
  }
  if (args.driftAnalysisId) {
    conditions.push(eq(schema.behaviorStabilizationRuns.driftAnalysisId, args.driftAnalysisId))
  }
  if (args.status) conditions.push(eq(schema.behaviorStabilizationRuns.status, args.status))
  return db.query.behaviorStabilizationRuns.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.behaviorStabilizationRuns.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function createStabilizationRun(args: {
  driftAnalysisId: string
  agentProfileId: string
  actions: string[]
}): Promise<BehaviorStabilizationRunRow> {
  const now = Date.now()
  const row: BehaviorStabilizationRunRow = {
    id: newBehaviorStabilizationRunId(),
    driftAnalysisId: args.driftAnalysisId,
    agentProfileId: args.agentProfileId,
    actions: args.actions,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.behaviorStabilizationRuns).values(row)
  return row
}

async function getRequiredBehaviorSnapshot(id: string): Promise<BehaviorSnapshotRow> {
  const snapshot = await db.query.behaviorSnapshots.findFirst({
    where: eq(schema.behaviorSnapshots.id, id),
  })
  if (!snapshot) throw new Error(`Behavior snapshot not found: ${id}`)
  return snapshot
}

function computeDriftedMetrics(
  baseline: BehaviorSnapshotRow,
  current: BehaviorSnapshotRow,
): JsonObject[] {
  const metrics: JsonObject[] = []
  addDeviation(metrics, 'avgStepsPerTask', baseline.avgStepsPerTask, current.avgStepsPerTask)
  addDeviation(metrics, 'avgCostPerTask', baseline.avgCostPerTask, current.avgCostPerTask)
  addDeviation(
    metrics,
    'approvalRequestRate',
    baseline.approvalRequestRate,
    current.approvalRequestRate,
  )
  addDeviation(metrics, 'outputVerbosity', baseline.outputVerbosity, current.outputVerbosity)
  if (baseline.typicalPlanStructure !== current.typicalPlanStructure) {
    metrics.push({
      metric: 'typicalPlanStructure',
      baseline: baseline.typicalPlanStructure,
      current: current.typicalPlanStructure,
      deviation: 1,
    })
  }
  if (baseline.toolPreferenceOrder.join('|') !== current.toolPreferenceOrder.join('|')) {
    metrics.push({
      metric: 'toolPreferenceOrder',
      baseline: baseline.toolPreferenceOrder,
      current: current.toolPreferenceOrder,
      deviation: 1,
    })
  }
  return metrics
}

function addDeviation(
  metrics: JsonObject[],
  metric: string,
  baseline: number,
  current: number,
): void {
  const deviation = baseline === 0 ? Math.abs(current) : Math.abs(current - baseline) / baseline
  if (deviation <= 0) return
  metrics.push({ metric, baseline, current, deviation })
}

function actionsFromConfig(config: StabilizationConfig | undefined): string[] {
  const actions: string[] = []
  if (config?.memoryHygiene) actions.push('memory_hygiene')
  if (config?.resetLearnedBehaviors) actions.push('reset_learned_behaviors')
  if (config?.reAnchorToOriginalConfig) actions.push('re_anchor_original_config')
  if (config?.recalibrateWithBenchmarks) actions.push('recalibrate_with_benchmarks')
  return actions
}

function recommendationFor(
  severity: BehaviorDriftAnalysisRow['severity'],
  policy: DriftResponsePolicy,
  actions: string[],
): string {
  if (severity === 'none') return 'No behavior drift detected.'
  if (severity === 'minor') return 'Monitor behavior on the next scheduled benchmark.'
  if (policy === 'notify') return 'Notify the user and wait for manual stabilization.'
  if (policy === 'auto_correct') return `Plan automatic stabilization: ${actions.join(', ') || 'none'}.`
  return `Ask the user before applying stabilization: ${actions.join(', ') || 'none'}.`
}

function numberAt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed
}
