import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  ModelBehaviorSnapshotRow,
  PromptDriftAction,
  PromptDriftChecks,
  PromptDriftMonitorRow,
  PromptDriftMonitorStatus,
  PromptDriftRunRow,
  PromptDriftRunStatus,
  PromptDriftSchedule,
} from '@/db/schema'
import {
  newModelBehaviorSnapshotId,
  newPromptDriftMonitorId,
  newPromptDriftRunId,
} from '@/server/ids'

export interface CreatePromptDriftMonitorArgs {
  agentProfileId?: string | null
  modelProfileId?: string | null
  name: string
  schedule?: PromptDriftSchedule
  checks?: Partial<PromptDriftChecks>
  onDriftDetected?: PromptDriftAction
  thresholds?: JsonObject
  status?: PromptDriftMonitorStatus
}

export interface CreateModelBehaviorSnapshotArgs {
  monitorId?: string | null
  agentProfileId?: string | null
  modelProfileId?: string | null
  modelName: string
  modelDate: string
  providerVersion?: string | null
  benchmarkResults: JsonObject
  pinned?: boolean
  notes?: string
}

export interface RunPromptDriftCheckArgs {
  monitorId: string
  baselineSnapshotId?: string
  candidateSnapshotId?: string
  baselineResults?: JsonObject
  candidateResults?: JsonObject
}

interface DriftSignal {
  check: keyof PromptDriftChecks
  metric: string
  baseline: number | string | null
  candidate: number | string | null
  delta: number | null
  threshold: number
  severity: 'warning' | 'drift'
  message: string
}

const defaultChecks: PromptDriftChecks = {
  outputFormatStability: true,
  refusalRateChange: true,
  verbosityChange: true,
  toolCallingAccuracy: true,
  reasoningQuality: true,
  latencyChange: true,
  costChange: true,
}

const defaultThresholds: Record<string, number> = {
  outputFormatStability: 0.05,
  refusalRateChange: 0.1,
  verbosityChange: 0.3,
  toolCallingAccuracy: 0.1,
  reasoningQuality: 0.1,
  latencyChange: 0.3,
  costChange: 0.3,
}

export async function createPromptDriftMonitor(
  args: CreatePromptDriftMonitorArgs,
): Promise<PromptDriftMonitorRow> {
  const now = Date.now()
  const row = {
    id: newPromptDriftMonitorId(),
    agentProfileId: normalizeNullable(args.agentProfileId),
    modelProfileId: normalizeNullable(args.modelProfileId),
    name: args.name.trim(),
    schedule: args.schedule ?? '30d',
    checks: { ...defaultChecks, ...(args.checks ?? {}) },
    onDriftDetected: args.onDriftDetected ?? 'notify_user',
    thresholds: { ...defaultThresholds, ...(args.thresholds ?? {}) },
    status: args.status ?? 'active',
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  }
  if (!row.name) throw new Error('Prompt drift monitor name is required.')
  await db.insert(schema.promptDriftMonitors).values(row)
  return row
}

export async function listPromptDriftMonitors(args: {
  agentProfileId?: string
  modelProfileId?: string
  schedule?: PromptDriftSchedule
  status?: PromptDriftMonitorStatus
  limit?: number
} = {}): Promise<PromptDriftMonitorRow[]> {
  const conditions: SQL[] = []
  if (args.agentProfileId) conditions.push(eq(schema.promptDriftMonitors.agentProfileId, args.agentProfileId))
  if (args.modelProfileId) conditions.push(eq(schema.promptDriftMonitors.modelProfileId, args.modelProfileId))
  if (args.schedule) conditions.push(eq(schema.promptDriftMonitors.schedule, args.schedule))
  if (args.status) conditions.push(eq(schema.promptDriftMonitors.status, args.status))
  return db.query.promptDriftMonitors.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.promptDriftMonitors.updatedAt)],
    limit: args.limit ?? 100,
  })
}

export async function createModelBehaviorSnapshot(
  args: CreateModelBehaviorSnapshotArgs,
): Promise<ModelBehaviorSnapshotRow> {
  const row = {
    id: newModelBehaviorSnapshotId(),
    monitorId: normalizeNullable(args.monitorId),
    agentProfileId: normalizeNullable(args.agentProfileId),
    modelProfileId: normalizeNullable(args.modelProfileId),
    modelName: args.modelName.trim(),
    modelDate: args.modelDate.trim(),
    providerVersion: normalizeNullable(args.providerVersion),
    benchmarkResults: args.benchmarkResults,
    pinned: args.pinned ?? false,
    notes: args.notes?.trim() ?? '',
    createdAt: Date.now(),
  }
  if (!row.modelName) throw new Error('Model name is required.')
  if (!row.modelDate) throw new Error('Model date is required.')
  await db.insert(schema.modelBehaviorSnapshots).values(row)
  return row
}

export async function listModelBehaviorSnapshots(args: {
  monitorId?: string
  agentProfileId?: string
  modelProfileId?: string
  modelName?: string
  pinned?: boolean
  limit?: number
} = {}): Promise<ModelBehaviorSnapshotRow[]> {
  const conditions: SQL[] = []
  if (args.monitorId) conditions.push(eq(schema.modelBehaviorSnapshots.monitorId, args.monitorId))
  if (args.agentProfileId) conditions.push(eq(schema.modelBehaviorSnapshots.agentProfileId, args.agentProfileId))
  if (args.modelProfileId) conditions.push(eq(schema.modelBehaviorSnapshots.modelProfileId, args.modelProfileId))
  if (args.modelName) conditions.push(eq(schema.modelBehaviorSnapshots.modelName, args.modelName))
  if (args.pinned !== undefined) conditions.push(eq(schema.modelBehaviorSnapshots.pinned, args.pinned))
  return db.query.modelBehaviorSnapshots.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.modelBehaviorSnapshots.createdAt)],
    limit: args.limit ?? 100,
  })
}

export async function runPromptDriftCheck(args: RunPromptDriftCheckArgs): Promise<PromptDriftRunRow> {
  const monitor = await db.query.promptDriftMonitors.findFirst({
    where: eq(schema.promptDriftMonitors.id, args.monitorId),
  })
  if (!monitor) throw new Error(`Prompt drift monitor not found: ${args.monitorId}`)

  const baselineSnapshot = args.baselineSnapshotId
    ? await findModelBehaviorSnapshot(args.baselineSnapshotId)
    : null
  const candidateSnapshot = args.candidateSnapshotId
    ? await findModelBehaviorSnapshot(args.candidateSnapshotId)
    : null
  const baseline = args.baselineResults ?? baselineSnapshot?.benchmarkResults ?? {}
  const candidate = args.candidateResults ?? candidateSnapshot?.benchmarkResults ?? {}
  const signals = compareBenchmarks(monitor, baseline, candidate)
  const status: PromptDriftRunStatus =
    signals.some((signal) => signal.severity === 'drift')
      ? 'drift_detected'
      : signals.length
        ? 'warning'
        : 'stable'
  const row = {
    id: newPromptDriftRunId(),
    monitorId: monitor.id,
    baselineSnapshotId: baselineSnapshot?.id ?? null,
    candidateSnapshotId: candidateSnapshot?.id ?? null,
    status,
    driftSignals: signals as unknown as JsonObject[],
    summary: buildSummary(status, signals),
    recommendedAction: status === 'stable' ? 'notify_user' : monitor.onDriftDetected,
    createdAt: Date.now(),
  }
  await db.insert(schema.promptDriftRuns).values(row)
  await db
    .update(schema.promptDriftMonitors)
    .set({ lastRunAt: row.createdAt, updatedAt: row.createdAt })
    .where(eq(schema.promptDriftMonitors.id, monitor.id))
  return row
}

export async function listPromptDriftRuns(args: {
  monitorId?: string
  status?: PromptDriftRunStatus
  limit?: number
} = {}): Promise<PromptDriftRunRow[]> {
  const conditions: SQL[] = []
  if (args.monitorId) conditions.push(eq(schema.promptDriftRuns.monitorId, args.monitorId))
  if (args.status) conditions.push(eq(schema.promptDriftRuns.status, args.status))
  return db.query.promptDriftRuns.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.promptDriftRuns.createdAt)],
    limit: args.limit ?? 100,
  })
}

async function findModelBehaviorSnapshot(id: string): Promise<ModelBehaviorSnapshotRow> {
  const snapshot = await db.query.modelBehaviorSnapshots.findFirst({
    where: eq(schema.modelBehaviorSnapshots.id, id),
  })
  if (!snapshot) throw new Error(`Model behavior snapshot not found: ${id}`)
  return snapshot
}

function compareBenchmarks(
  monitor: PromptDriftMonitorRow,
  baseline: JsonObject,
  candidate: JsonObject,
): DriftSignal[] {
  const signals: DriftSignal[] = []
  if (monitor.checks.outputFormatStability) {
    maybePushDropSignal(signals, monitor, 'outputFormatStability', 'output_format_schema_score', baseline, candidate)
  }
  if (monitor.checks.refusalRateChange) {
    maybePushIncreaseSignal(signals, monitor, 'refusalRateChange', 'refusal_rate', baseline, candidate)
  }
  if (monitor.checks.verbosityChange) {
    maybePushRatioSignal(signals, monitor, 'verbosityChange', 'avg_output_tokens', baseline, candidate)
  }
  if (monitor.checks.toolCallingAccuracy) {
    maybePushDropSignal(signals, monitor, 'toolCallingAccuracy', 'tool_call_accuracy', baseline, candidate)
  }
  if (monitor.checks.reasoningQuality) {
    maybePushDropSignal(signals, monitor, 'reasoningQuality', 'reasoning_quality_score', baseline, candidate)
  }
  if (monitor.checks.latencyChange) {
    maybePushRatioSignal(signals, monitor, 'latencyChange', 'latency_ms_p95', baseline, candidate)
  }
  if (monitor.checks.costChange) {
    maybePushRatioSignal(signals, monitor, 'costChange', 'cost_usd_per_task', baseline, candidate)
  }
  return signals
}

function maybePushDropSignal(
  signals: DriftSignal[],
  monitor: PromptDriftMonitorRow,
  check: keyof PromptDriftChecks,
  metric: string,
  baseline: JsonObject,
  candidate: JsonObject,
) {
  const base = numberMetric(baseline, metric)
  const next = numberMetric(candidate, metric)
  if (base === null || next === null) return
  const delta = base - next
  const threshold = thresholdFor(monitor, check)
  if (delta > threshold) {
    signals.push(signal(check, metric, base, next, delta, threshold, `${metric} dropped by ${round(delta)}.`))
  }
}

function maybePushIncreaseSignal(
  signals: DriftSignal[],
  monitor: PromptDriftMonitorRow,
  check: keyof PromptDriftChecks,
  metric: string,
  baseline: JsonObject,
  candidate: JsonObject,
) {
  const base = numberMetric(baseline, metric)
  const next = numberMetric(candidate, metric)
  if (base === null || next === null) return
  const delta = next - base
  const threshold = thresholdFor(monitor, check)
  if (delta > threshold) {
    signals.push(signal(check, metric, base, next, delta, threshold, `${metric} increased by ${round(delta)}.`))
  }
}

function maybePushRatioSignal(
  signals: DriftSignal[],
  monitor: PromptDriftMonitorRow,
  check: keyof PromptDriftChecks,
  metric: string,
  baseline: JsonObject,
  candidate: JsonObject,
) {
  const base = numberMetric(baseline, metric)
  const next = numberMetric(candidate, metric)
  if (base === null || next === null || base === 0) return
  const delta = Math.abs(next - base) / base
  const threshold = thresholdFor(monitor, check)
  if (delta > threshold) {
    signals.push(signal(check, metric, base, next, delta, threshold, `${metric} changed by ${round(delta * 100)}%.`))
  }
}

function signal(
  check: keyof PromptDriftChecks,
  metric: string,
  baseline: number,
  candidate: number,
  delta: number,
  threshold: number,
  message: string,
): DriftSignal {
  return {
    check,
    metric,
    baseline,
    candidate,
    delta: round(delta),
    threshold,
    severity: delta > threshold * 1.5 ? 'drift' : 'warning',
    message,
  }
}

function thresholdFor(monitor: PromptDriftMonitorRow, check: keyof PromptDriftChecks): number {
  const raw = monitor.thresholds[check]
  return typeof raw === 'number' ? raw : defaultThresholds[check]
}

function numberMetric(results: JsonObject, metric: string): number | null {
  const value = results[metric]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildSummary(status: PromptDriftRunStatus, signals: DriftSignal[]): string {
  if (status === 'stable') return 'No prompt or model behavior drift detected.'
  const metrics = signals.map((signal) => signal.metric).join(', ')
  return `${signals.length} drift signal(s) detected: ${metrics}.`
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}
