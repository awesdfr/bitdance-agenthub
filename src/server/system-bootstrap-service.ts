import os from 'node:os'

import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  SystemBootstrapCheckRow,
  SystemBootstrapCheckStatus,
  SystemBootstrapComponent,
} from '@/db/schema'
import { newSystemBootstrapCheckId, newSystemBootstrapRunId } from '@/server/ids'

export interface RunSystemBootstrapCheckArgs {
  observed?: JsonObject
  thresholds?: JsonObject
  now?: number
}

interface CheckDraft {
  component: SystemBootstrapComponent
  status: SystemBootstrapCheckStatus
  observed: JsonObject
  threshold?: JsonObject
  recommendation?: string
}

const defaultThresholds: Record<string, number> = {
  minFreeMemoryMb: 512,
  maxRunningAgents: 8,
  maxPendingApprovals: 10,
  maxApiLatencyMs: 1500,
  maxWebsocketConnections: 100,
  minEventThroughputPerMinute: 1,
  maxDbSlowQueries: 0,
  maxCheckpointLatencyMs: 1000,
}

export async function runSystemBootstrapChecks(
  args: RunSystemBootstrapCheckArgs = {},
): Promise<SystemBootstrapCheckRow[]> {
  const now = args.now ?? Date.now()
  const thresholds = { ...defaultThresholds, ...numberMap(args.thresholds) }
  const runId = newSystemBootstrapRunId()

  const [
    modelProfiles,
    mcpServers,
    taskQueues,
    employeeRuns,
    approvalRequests,
    checkpoints,
    metaAgentProfiles,
  ] = await Promise.all([
    db.query.modelProfiles.findMany(),
    db.query.mcpServers.findMany(),
    db.query.taskQueues.findMany(),
    db.query.employeeRuns.findMany(),
    db.query.approvalRequests.findMany(),
    db.query.runtimeCheckpoints.findMany(),
    db.query.metaAgentProfiles.findMany(),
  ])

  const runningAgents = employeeRuns.filter((run) => run.status === 'running').length
  const pendingApprovals = approvalRequests.filter((approval) => approval.status === 'pending').length
  const apiLatencyMs = numberMetric(args.observed, 'apiLatencyMs', 0)
  const websocketConnections = numberMetric(args.observed, 'websocketConnections', 0)
  const eventThroughputPerMinute = numberMetric(args.observed, 'eventThroughputPerMinute', 1)
  const dbSlowQueries = numberMetric(args.observed, 'dbSlowQueries', 0)
  const checkpointLatencyMs = numberMetric(args.observed, 'checkpointLatencyMs', 0)
  const freeMemoryMb = Math.round(os.freemem() / 1024 / 1024)
  const totalMemoryMb = Math.round(os.totalmem() / 1024 / 1024)
  const activeMetaAgent = metaAgentProfiles.some((profile) => profile.status === 'active')

  const drafts: CheckDraft[] = [
    {
      component: 'database_connection',
      status: 'ok',
      observed: { connected: true, checkedTables: ['model_profiles', 'mcp_servers', 'employee_runs'] },
      recommendation: 'Database connection is available for system bootstrap.',
    },
    {
      component: 'message_queue',
      status: taskQueues.length ? 'ok' : 'warning',
      observed: { queueCount: taskQueues.length },
      recommendation: taskQueues.length
        ? 'Task queues are registered.'
        : 'Create at least one task queue before relying on background scheduling.',
    },
    {
      component: 'model_providers',
      status: modelProfiles.length ? modelProfileStatus(modelProfiles) : 'warning',
      observed: {
        count: modelProfiles.length,
        ok: modelProfiles.filter((profile) => profile.healthStatus === 'ok').length,
        failed: modelProfiles.filter((profile) => profile.healthStatus === 'failed').length,
      },
      recommendation: modelProfiles.length
        ? 'Review failed model profiles before starting autonomous runs.'
        : 'Configure and test at least one model profile.',
    },
    {
      component: 'mcp_servers',
      status: mcpServers.some((server) => server.healthStatus === 'failed') ? 'warning' : 'ok',
      observed: {
        count: mcpServers.length,
        failed: mcpServers.filter((server) => server.healthStatus === 'failed').length,
      },
      recommendation: 'Check MCP server health before tool-heavy workflows.',
    },
    {
      component: 'disk_space',
      status: 'ok',
      observed: { measured: false, note: 'Disk stat is reserved for packaged desktop runtime.' },
      recommendation: 'Enable packaged-runtime disk quota probes before long-running local automation.',
    },
    {
      component: 'memory_usage',
      status: freeMemoryMb >= thresholds.minFreeMemoryMb ? 'ok' : 'warning',
      observed: { freeMemoryMb, totalMemoryMb },
      threshold: { minFreeMemoryMb: thresholds.minFreeMemoryMb },
      recommendation:
        freeMemoryMb >= thresholds.minFreeMemoryMb
          ? 'Memory headroom is acceptable.'
          : 'Pause nonessential Agents or lower concurrency before starting new runs.',
    },
    {
      component: 'running_agents',
      status: runningAgents <= thresholds.maxRunningAgents ? 'ok' : 'warning',
      observed: { runningAgents },
      threshold: { maxRunningAgents: thresholds.maxRunningAgents },
      recommendation: 'Keep running Agent count within configured concurrency limits.',
    },
    {
      component: 'pending_approvals',
      status: pendingApprovals <= thresholds.maxPendingApprovals ? 'ok' : 'warning',
      observed: { pendingApprovals },
      threshold: { maxPendingApprovals: thresholds.maxPendingApprovals },
      recommendation: 'Review pending approvals so Agent work does not stall.',
    },
    {
      component: 'api_latency',
      status: apiLatencyMs <= thresholds.maxApiLatencyMs ? 'ok' : 'warning',
      observed: { apiLatencyMs },
      threshold: { maxApiLatencyMs: thresholds.maxApiLatencyMs },
      recommendation: 'Investigate API latency spikes in Observability Center.',
    },
    {
      component: 'websocket_connections',
      status: websocketConnections <= thresholds.maxWebsocketConnections ? 'ok' : 'warning',
      observed: { websocketConnections },
      threshold: { maxWebsocketConnections: thresholds.maxWebsocketConnections },
      recommendation: 'Review live stream fan-out when websocket connections exceed the threshold.',
    },
    {
      component: 'event_throughput',
      status: eventThroughputPerMinute >= thresholds.minEventThroughputPerMinute ? 'ok' : 'warning',
      observed: { eventThroughputPerMinute },
      threshold: { minEventThroughputPerMinute: thresholds.minEventThroughputPerMinute },
      recommendation: 'Check event bus throughput if run timelines stop advancing.',
    },
    {
      component: 'database_slow_queries',
      status: dbSlowQueries <= thresholds.maxDbSlowQueries ? 'ok' : 'warning',
      observed: { dbSlowQueries },
      threshold: { maxDbSlowQueries: thresholds.maxDbSlowQueries },
      recommendation: 'Use performance analysis records to identify slow database queries.',
    },
    {
      component: 'checkpoint_latency',
      status: checkpointLatencyMs <= thresholds.maxCheckpointLatencyMs ? 'ok' : 'warning',
      observed: { checkpointLatencyMs, checkpointCount: checkpoints.length },
      threshold: { maxCheckpointLatencyMs: thresholds.maxCheckpointLatencyMs },
      recommendation: 'High checkpoint latency can weaken crash recovery guarantees.',
    },
    {
      component: 'ops_agent',
      status: activeMetaAgent ? 'ok' : 'warning',
      observed: { activeMetaAgent },
      recommendation: activeMetaAgent
        ? 'Meta/Ops Agent is available for health monitoring and optimization suggestions.'
        : 'Create an active Meta/Ops Agent to monitor health, cleanup, alerts, and optimization suggestions.',
    },
  ]

  const rows: SystemBootstrapCheckRow[] = drafts.map((draft) => ({
    id: newSystemBootstrapCheckId(),
    runId,
    component: draft.component,
    status: draft.status,
    observed: draft.observed,
    threshold: draft.threshold ?? {},
    recommendation: draft.recommendation ?? '',
    createdAt: now,
  }))
  await db.insert(schema.systemBootstrapChecks).values(rows)
  return rows
}

export async function listSystemBootstrapChecks(args: {
  runId?: string
  component?: SystemBootstrapComponent
  status?: SystemBootstrapCheckStatus
  limit?: number
} = {}): Promise<SystemBootstrapCheckRow[]> {
  const conditions: SQL[] = []
  if (args.runId) conditions.push(eq(schema.systemBootstrapChecks.runId, args.runId))
  if (args.component) conditions.push(eq(schema.systemBootstrapChecks.component, args.component))
  if (args.status) conditions.push(eq(schema.systemBootstrapChecks.status, args.status))
  return db.query.systemBootstrapChecks.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(schema.systemBootstrapChecks.createdAt)],
    limit: args.limit ?? 100,
  })
}

function modelProfileStatus(
  modelProfiles: Array<{ healthStatus: 'unknown' | 'ok' | 'failed' }>,
): SystemBootstrapCheckStatus {
  if (modelProfiles.some((profile) => profile.healthStatus === 'failed')) return 'warning'
  return 'ok'
}

function numberMetric(source: JsonObject | undefined, key: string, fallback: number): number {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function numberMap(source: JsonObject | undefined): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(source ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value
  }
  return result
}
