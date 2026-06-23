import os from 'node:os'

import { desc, eq } from 'drizzle-orm'

import { db, schema, sqlite } from '@/db/client'
import type {
  ExternalMonitoringConfigRow,
  ExternalMonitoringLogExport,
  ExternalMonitoringStatus,
  JsonObject,
} from '@/db/schema'
import { newExternalMonitoringConfigId } from '@/server/ids'
import { recordAuditLog } from '@/server/security-service'

export interface CreateExternalMonitoringConfigArgs {
  name: string
  metricsEndpoint?: string
  healthEndpoint?: string
  readyEndpoint?: string
  logExport?: ExternalMonitoringLogExport
  status?: ExternalMonitoringStatus
}

export interface ProbeCheck {
  name: string
  status: 'ok' | 'warning' | 'failed'
  message: string
}

export interface HealthProbe {
  status: 'ok' | 'degraded'
  checkedAt: number
  checks: ProbeCheck[]
}

export interface ReadyProbe {
  ready: boolean
  status: 'ready' | 'not_ready'
  checkedAt: number
  checks: ProbeCheck[]
}

const DEFAULT_LOG_EXPORT: ExternalMonitoringLogExport = {
  format: 'json',
  destination: 'stdout',
  structured: true,
  redactSensitive: true,
  target: null,
}

export async function createExternalMonitoringConfig(
  args: CreateExternalMonitoringConfigArgs,
): Promise<ExternalMonitoringConfigRow> {
  const now = Date.now()
  const row: ExternalMonitoringConfigRow = {
    id: newExternalMonitoringConfigId(),
    name: normalizeRequired(args.name, 'name'),
    metricsEndpoint: args.metricsEndpoint?.trim() || '/metrics',
    healthEndpoint: args.healthEndpoint?.trim() || '/health',
    readyEndpoint: args.readyEndpoint?.trim() || '/ready',
    logExport: { ...DEFAULT_LOG_EXPORT, ...(args.logExport ?? {}) },
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.externalMonitoringConfigs).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'external_monitoring.config.create',
    resourceType: 'external_monitoring_config',
    resourceId: row.id,
    status: 'allowed',
    riskLevel: row.logExport.destination === 'http' || row.logExport.destination === 'elasticsearch' ? 'medium' : 'low',
    message: `External monitoring config ${row.name} was created.`,
    metadata: {
      metricsEndpoint: row.metricsEndpoint,
      healthEndpoint: row.healthEndpoint,
      readyEndpoint: row.readyEndpoint,
      logExport: row.logExport,
    },
  })
  return row
}

export async function listExternalMonitoringConfigs(args: {
  status?: ExternalMonitoringStatus
  limit?: number
} = {}): Promise<ExternalMonitoringConfigRow[]> {
  return db.query.externalMonitoringConfigs.findMany({
    where: args.status ? eq(schema.externalMonitoringConfigs.status, args.status) : undefined,
    orderBy: [desc(schema.externalMonitoringConfigs.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 300),
  })
}

export async function buildPrometheusMetrics(): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const durationSeconds = taskDurationsSeconds()
  const buckets = [1, 5, 30, 60, 300]
  const lines: string[] = [
    '# HELP reasonix_agents_total Total configured Agent profiles.',
    '# TYPE reasonix_agents_total gauge',
    `reasonix_agents_total ${count('agent_profiles')}`,
    '# HELP reasonix_agents_running Agent employee runs currently running.',
    '# TYPE reasonix_agents_running gauge',
    `reasonix_agents_running ${countWhere('employee_runs', 'status = ?', ['running'])}`,
    '# HELP reasonix_tasks_total Total queued task records.',
    '# TYPE reasonix_tasks_total counter',
    `reasonix_tasks_total ${count('task_queue_items')}`,
    '# HELP reasonix_tasks_completed Completed queued tasks.',
    '# TYPE reasonix_tasks_completed counter',
    `reasonix_tasks_completed ${countWhere('task_queue_items', 'status = ?', ['complete'])}`,
    '# HELP reasonix_tasks_failed Failed queued tasks.',
    '# TYPE reasonix_tasks_failed counter',
    `reasonix_tasks_failed ${countWhere('task_queue_items', 'status = ?', ['failed'])}`,
    '# HELP reasonix_task_duration_seconds Duration of completed queued tasks.',
    '# TYPE reasonix_task_duration_seconds histogram',
    ...histogramLines('reasonix_task_duration_seconds', durationSeconds, buckets),
    '# HELP reasonix_model_calls_total Estimated model call records.',
    '# TYPE reasonix_model_calls_total counter',
    `reasonix_model_calls_total ${count('budget_events')}`,
    '# HELP reasonix_model_tokens_total Estimated context tokens used by runtime snapshots.',
    '# TYPE reasonix_model_tokens_total counter',
    `reasonix_model_tokens_total ${sumColumn('runtime_context_snapshots', 'token_estimate')}`,
    '# HELP reasonix_cost_total Total recorded Agent spend in cents.',
    '# TYPE reasonix_cost_total counter',
    `reasonix_cost_total ${sumWhere('budget_events', 'amount_cents', 'event_type = ?', ['spend'])}`,
    '# HELP reasonix_resource_locks_waiting Resource lock wait queue size.',
    '# TYPE reasonix_resource_locks_waiting gauge',
    'reasonix_resource_locks_waiting 0',
    '# HELP reasonix_memory_bytes Current Node.js resident memory usage.',
    '# TYPE reasonix_memory_bytes gauge',
    `reasonix_memory_bytes ${process.memoryUsage().rss}`,
    '# HELP reasonix_disk_bytes Current database-backed local storage size.',
    '# TYPE reasonix_disk_bytes gauge',
    `reasonix_disk_bytes ${databaseSizeBytes()}`,
    '# HELP reasonix_db_size_bytes SQLite database size.',
    '# TYPE reasonix_db_size_bytes gauge',
    `reasonix_db_size_bytes ${databaseSizeBytes()}`,
    '# HELP reasonix_event_queue_size Queued task/event backlog.',
    '# TYPE reasonix_event_queue_size gauge',
    `reasonix_event_queue_size ${countWhere('task_queue_items', 'status = ?', ['queued'])}`,
    '# HELP reasonix_metrics_generated_at_seconds Unix time when metrics were generated.',
    '# TYPE reasonix_metrics_generated_at_seconds gauge',
    `reasonix_metrics_generated_at_seconds ${nowSeconds}`,
  ]
  return `${lines.join('\n')}\n`
}

export async function getHealthProbe(): Promise<HealthProbe> {
  const checks = [databaseCheck(), memoryCheck(), eventQueueCheck()]
  return {
    status: checks.some((check) => check.status === 'failed') ? 'degraded' : 'ok',
    checkedAt: Date.now(),
    checks,
  }
}

export async function getReadyProbe(): Promise<ReadyProbe> {
  const checks = [databaseCheck(), maintenanceCheck(), eventQueueCheck()]
  const ready = checks.every((check) => check.status !== 'failed')
  return {
    ready,
    status: ready ? 'ready' : 'not_ready',
    checkedAt: Date.now(),
    checks,
  }
}

function histogramLines(metricName: string, values: number[], buckets: number[]): string[] {
  const lines = buckets.map((bucket) => {
    const countInBucket = values.filter((value) => value <= bucket).length
    return `${metricName}_bucket{le="${bucket}"} ${countInBucket}`
  })
  lines.push(`${metricName}_bucket{le="+Inf"} ${values.length}`)
  lines.push(`${metricName}_sum ${round3(values.reduce((sum, value) => sum + value, 0))}`)
  lines.push(`${metricName}_count ${values.length}`)
  return lines
}

function taskDurationsSeconds(): number[] {
  const rows = sqlite
    .prepare(
      `SELECT started_at AS startedAt, finished_at AS finishedAt
       FROM task_queue_items
       WHERE started_at IS NOT NULL AND finished_at IS NOT NULL AND status = 'complete'
       LIMIT 1000`,
    )
    .all() as Array<{ startedAt: number; finishedAt: number }>
  return rows
    .map((row) => Math.max(0, row.finishedAt - row.startedAt) / 1000)
    .filter((value) => Number.isFinite(value))
}

function databaseCheck(): ProbeCheck {
  try {
    const row = sqlite.prepare('SELECT 1 AS ok').get() as { ok: number }
    return row.ok === 1
      ? { name: 'database', status: 'ok', message: 'SQLite is reachable.' }
      : { name: 'database', status: 'failed', message: 'SQLite health query returned an unexpected value.' }
  } catch (err) {
    return { name: 'database', status: 'failed', message: formatError(err) }
  }
}

function memoryCheck(): ProbeCheck {
  const rss = process.memoryUsage().rss
  const total = os.totalmem()
  const ratio = total > 0 ? rss / total : 0
  if (ratio > 0.9) return { name: 'memory', status: 'warning', message: 'Process memory is above 90% of system memory.' }
  return { name: 'memory', status: 'ok', message: `Process RSS is ${rss} bytes.` }
}

function eventQueueCheck(): ProbeCheck {
  const queued = countWhere('task_queue_items', 'status = ?', ['queued'])
  if (queued > 10000) return { name: 'event_queue', status: 'warning', message: `Queued task backlog is ${queued}.` }
  return { name: 'event_queue', status: 'ok', message: `Queued task backlog is ${queued}.` }
}

function maintenanceCheck(): ProbeCheck {
  const active = tableExists('maintenance_windows')
    ? countWhere('maintenance_windows', 'status = ?', ['active'])
    : 0
  if (active > 0) return { name: 'maintenance', status: 'failed', message: 'Active maintenance window blocks readiness.' }
  return { name: 'maintenance', status: 'ok', message: 'No active maintenance window.' }
}

function count(table: string): number {
  return scalar(`SELECT COUNT(*) AS value FROM ${table}`)
}

function countWhere(table: string, where: string, params: unknown[]): number {
  return scalar(`SELECT COUNT(*) AS value FROM ${table} WHERE ${where}`, params)
}

function sumColumn(table: string, column: string): number {
  return scalar(`SELECT COALESCE(SUM(${column}), 0) AS value FROM ${table}`)
}

function sumWhere(table: string, column: string, where: string, params: unknown[]): number {
  return scalar(`SELECT COALESCE(SUM(${column}), 0) AS value FROM ${table} WHERE ${where}`, params)
}

function scalar(sql: string, params: unknown[] = []): number {
  const row = sqlite.prepare(sql).get(...params) as { value?: number | null } | undefined
  return Number(row?.value ?? 0)
}

function databaseSizeBytes(): number {
  const pageCount = pragmaScalar('page_count')
  const pageSize = pragmaScalar('page_size')
  return pageCount * pageSize
}

function pragmaScalar(name: 'page_count' | 'page_size'): number {
  const row = sqlite.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined
  return Number(row?.[name] ?? 0)
}

function tableExists(table: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name?: string } | undefined
  return row?.name === table
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function normalizeRequired(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function externalMonitoringConfigSnapshot(row: ExternalMonitoringConfigRow): JsonObject {
  return {
    name: row.name,
    metricsEndpoint: row.metricsEndpoint,
    healthEndpoint: row.healthEndpoint,
    readyEndpoint: row.readyEndpoint,
    logExport: row.logExport,
    status: row.status,
  }
}
