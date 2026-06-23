import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ResourceGovernorAction,
  ResourceGovernorDecision,
  ResourceGovernorEvaluationRow,
  ResourceGovernorPolicy,
  ResourceGovernorPolicyRow,
  ResourceGovernorSnapshot,
  ResourceGovernorStatus,
} from '@/db/schema'
import { newResourceGovernorEvaluationId, newResourceGovernorPolicyId } from '@/server/ids'

export interface EvaluateResourceGovernorArgs {
  policyId?: string
  snapshot: ResourceGovernorSnapshot
}

export interface ResourceGovernorEvaluationResult {
  policy: ResourceGovernorPolicyRow
  evaluation: ResourceGovernorEvaluationRow
  summary: {
    decisionCount: number
    critical: number
    warnings: number
    actions: ResourceGovernorAction[]
  }
}

const DEFAULT_POLICY_NAME = 'Default local Agent resource governor'

const defaultPolicy: ResourceGovernorPolicy = {
  quotas: {
    maxTotalCPUPercent: 85,
    maxPerAgentCPUPercent: 55,
    maxTotalMemoryMB: 16384,
    maxPerAgentMemoryMB: 4096,
    maxTotalGPUVRAMMB: 8192,
    maxPerAgentGPUVRAMMB: 4096,
    maxTotalNetworkKBps: 50000,
    maxDiskIOKBps: 80000,
  },
  priorities: {
    foregroundAgentBoost: 1.5,
    backgroundAgentThrottle: 0.5,
  },
  battery: {
    maxConcurrentAgentsOnBattery: 2,
    lowBatteryPercent: 20,
    criticalBatteryPercent: 5,
    disableLocalLLMOnBattery: true,
    checkpointEveryStepsOnBattery: 1,
  },
  thermal: {
    highCPUTempC: 85,
    highGPUTempC: 82,
    onThermalPressure: 'throttle',
    trayStatusRequired: true,
  },
  onResourcePressure: 'throttle',
}

export async function seedResourceGovernorPolicy(): Promise<ResourceGovernorPolicyRow> {
  const existing = await db.query.resourceGovernorPolicies.findFirst({
    where: eq(schema.resourceGovernorPolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  const now = Date.now()
  const row: ResourceGovernorPolicyRow = {
    id: newResourceGovernorPolicyId(),
    name: DEFAULT_POLICY_NAME,
    policy: defaultPolicy,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.resourceGovernorPolicies).values(row)
  return row
}

export async function listResourceGovernorPolicies(args: {
  status?: ResourceGovernorPolicyRow['status']
  limit?: number
} = {}): Promise<ResourceGovernorPolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.resourceGovernorPolicies.status, args.status))
  return db.query.resourceGovernorPolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.resourceGovernorPolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function evaluateResourceGovernor(
  args: EvaluateResourceGovernorArgs,
): Promise<ResourceGovernorEvaluationResult> {
  const policy = args.policyId
    ? await getRequiredPolicy(args.policyId)
    : await seedResourceGovernorPolicy()
  if (policy.status !== 'active') throw new Error(`Resource governor policy is ${policy.status}: ${policy.id}`)

  const snapshot = normalizeSnapshot(args.snapshot)
  const decisions = collectDecisions(snapshot, policy.policy)
  const actions = uniqueActions(decisions)
  if (!actions.length) actions.push('continue')
  const status = statusFromDecisions(decisions)
  const maxConcurrentAgents = calculateMaxConcurrentAgents(snapshot, policy.policy, decisions)
  const evaluation: ResourceGovernorEvaluationRow = {
    id: newResourceGovernorEvaluationId(),
    policyId: policy.id,
    snapshot,
    decisions,
    actions,
    status,
    maxConcurrentAgents,
    recommendation: recommendationFor(status, actions, maxConcurrentAgents),
    createdAt: Date.now(),
  }
  await db.insert(schema.resourceGovernorEvaluations).values(evaluation)
  return {
    policy,
    evaluation,
    summary: {
      decisionCount: decisions.length,
      critical: decisions.filter((decision) => decision.severity === 'critical').length,
      warnings: decisions.filter((decision) => decision.severity === 'warning').length,
      actions,
    },
  }
}

export async function listResourceGovernorEvaluations(args: {
  status?: ResourceGovernorStatus
  limit?: number
} = {}): Promise<ResourceGovernorEvaluationRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.resourceGovernorEvaluations.status, args.status))
  return db.query.resourceGovernorEvaluations.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.resourceGovernorEvaluations.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

function normalizeSnapshot(snapshot: ResourceGovernorSnapshot): ResourceGovernorSnapshot {
  return {
    totalCPUPercent: boundedPercent(snapshot.totalCPUPercent),
    perAgentCPUPercent: snapshot.perAgentCPUPercent ?? {},
    totalMemoryMB: Math.max(snapshot.totalMemoryMB ?? 0, 0),
    perAgentMemoryMB: snapshot.perAgentMemoryMB ?? {},
    totalGPUVRAMMB: Math.max(snapshot.totalGPUVRAMMB ?? 0, 0),
    perAgentGPUVRAMMB: snapshot.perAgentGPUVRAMMB ?? {},
    totalNetworkKBps: Math.max(snapshot.totalNetworkKBps ?? 0, 0),
    diskIOKBps: Math.max(snapshot.diskIOKBps ?? 0, 0),
    activeAgentCount: Math.max(snapshot.activeAgentCount ?? 0, 0),
    foregroundAgentId: snapshot.foregroundAgentId,
    powerSource: snapshot.powerSource ?? 'ac',
    batteryPercent: snapshot.batteryPercent === undefined ? undefined : boundedPercent(snapshot.batteryPercent),
    cpuTempC: snapshot.cpuTempC,
    gpuTempC: snapshot.gpuTempC,
  }
}

function boundedPercent(value: number | undefined): number {
  if (value === undefined) return 0
  return Math.min(Math.max(value, 0), 100)
}

function collectDecisions(
  snapshot: ResourceGovernorSnapshot,
  policy: ResourceGovernorPolicy,
): ResourceGovernorDecision[] {
  const decisions: ResourceGovernorDecision[] = []
  const pressureAction = policy.onResourcePressure
  if ((snapshot.totalCPUPercent ?? 0) > policy.quotas.maxTotalCPUPercent) {
    decisions.push(decision(
      'cpu_pressure',
      'warning',
      `Total CPU ${snapshot.totalCPUPercent}% exceeds ${policy.quotas.maxTotalCPUPercent}%.`,
      [pressureAction, 'reduce_concurrency'],
      heavyAgents(snapshot.perAgentCPUPercent, policy.quotas.maxPerAgentCPUPercent, snapshot.foregroundAgentId),
    ))
  }
  const perAgentCPU = heavyAgents(snapshot.perAgentCPUPercent, policy.quotas.maxPerAgentCPUPercent, snapshot.foregroundAgentId)
  if (perAgentCPU.length) {
    decisions.push(decision(
      'cpu_pressure',
      'warning',
      `Per-Agent CPU exceeds ${policy.quotas.maxPerAgentCPUPercent}% for ${perAgentCPU.join(', ')}.`,
      ['throttle'],
      perAgentCPU,
    ))
  }
  if ((snapshot.totalMemoryMB ?? 0) > policy.quotas.maxTotalMemoryMB) {
    decisions.push(decision(
      'memory_pressure',
      'warning',
      `Total memory ${snapshot.totalMemoryMB}MB exceeds ${policy.quotas.maxTotalMemoryMB}MB.`,
      [pressureAction, 'pause_low_priority'],
      heavyAgents(snapshot.perAgentMemoryMB, policy.quotas.maxPerAgentMemoryMB, snapshot.foregroundAgentId),
    ))
  }
  const perAgentMemory = heavyAgents(
    snapshot.perAgentMemoryMB,
    policy.quotas.maxPerAgentMemoryMB,
    snapshot.foregroundAgentId,
  )
  if (perAgentMemory.length) {
    decisions.push(decision(
      'memory_pressure',
      'warning',
      `Per-Agent memory exceeds ${policy.quotas.maxPerAgentMemoryMB}MB for ${perAgentMemory.join(', ')}.`,
      ['pause_low_priority'],
      perAgentMemory,
    ))
  }
  if ((snapshot.totalGPUVRAMMB ?? 0) > policy.quotas.maxTotalGPUVRAMMB) {
    decisions.push(decision(
      'gpu_pressure',
      'critical',
      `GPU VRAM ${snapshot.totalGPUVRAMMB}MB exceeds ${policy.quotas.maxTotalGPUVRAMMB}MB.`,
      ['disable_local_llm', 'use_cheaper_model', 'pause_low_priority'],
      heavyAgents(snapshot.perAgentGPUVRAMMB, policy.quotas.maxPerAgentGPUVRAMMB, snapshot.foregroundAgentId),
    ))
  }
  if ((snapshot.totalNetworkKBps ?? 0) > policy.quotas.maxTotalNetworkKBps) {
    decisions.push(decision(
      'network_pressure',
      'warning',
      `Network throughput ${snapshot.totalNetworkKBps}KBps exceeds ${policy.quotas.maxTotalNetworkKBps}KBps.`,
      ['throttle'],
      [],
    ))
  }
  if ((snapshot.diskIOKBps ?? 0) > policy.quotas.maxDiskIOKBps) {
    decisions.push(decision(
      'disk_io_pressure',
      'warning',
      `Disk I/O ${snapshot.diskIOKBps}KBps exceeds ${policy.quotas.maxDiskIOKBps}KBps.`,
      ['throttle', 'pause_low_priority'],
      [],
    ))
  }
  collectBatteryDecisions(snapshot, policy, decisions)
  collectThermalDecisions(snapshot, policy, decisions)
  return decisions
}

function collectBatteryDecisions(
  snapshot: ResourceGovernorSnapshot,
  policy: ResourceGovernorPolicy,
  decisions: ResourceGovernorDecision[],
) {
  if (snapshot.powerSource !== 'battery') return
  const batteryPercent = snapshot.batteryPercent ?? 100
  const batteryActions: ResourceGovernorAction[] = [
    'reduce_concurrency',
    'use_cheaper_model',
    'increase_checkpoint_frequency',
    'slow_browser_actions',
  ]
  if (policy.battery.disableLocalLLMOnBattery) batteryActions.push('disable_local_llm')
  decisions.push(decision(
    'battery_mode',
    'info',
    `Battery mode active; cap concurrent Agents at ${policy.battery.maxConcurrentAgentsOnBattery}.`,
    batteryActions,
    [],
  ))
  if (batteryPercent < policy.battery.criticalBatteryPercent) {
    decisions.push(decision(
      'critical_battery',
      'critical',
      `Battery ${batteryPercent}% is below critical threshold ${policy.battery.criticalBatteryPercent}%.`,
      ['pause_low_priority', 'force_checkpoint', 'notify_user'],
      [],
    ))
  } else if (batteryPercent < policy.battery.lowBatteryPercent) {
    decisions.push(decision(
      'low_battery',
      'warning',
      `Battery ${batteryPercent}% is below low threshold ${policy.battery.lowBatteryPercent}%.`,
      ['pause_low_priority', 'increase_checkpoint_frequency', 'notify_user'],
      [],
    ))
  }
}

function collectThermalDecisions(
  snapshot: ResourceGovernorSnapshot,
  policy: ResourceGovernorPolicy,
  decisions: ResourceGovernorDecision[],
) {
  const hotCPU = snapshot.cpuTempC !== undefined && snapshot.cpuTempC >= policy.thermal.highCPUTempC
  const hotGPU = snapshot.gpuTempC !== undefined && snapshot.gpuTempC >= policy.thermal.highGPUTempC
  if (!hotCPU && !hotGPU) return
  const actions: ResourceGovernorAction[] = [policy.thermal.onThermalPressure, 'reduce_concurrency', 'use_cheaper_model']
  if (policy.thermal.trayStatusRequired) actions.push('show_tray_resource_status')
  decisions.push(decision(
    'thermal_pressure',
    hotCPU && hotGPU ? 'critical' : 'warning',
    `Thermal pressure detected: CPU ${snapshot.cpuTempC ?? 'n/a'}C, GPU ${snapshot.gpuTempC ?? 'n/a'}C.`,
    actions,
    [],
  ))
}

function heavyAgents(
  usage: Record<string, number> | undefined,
  limit: number,
  foregroundAgentId?: string,
): string[] {
  return Object.entries(usage ?? {})
    .filter(([, value]) => value > limit)
    .sort(([, a], [, b]) => b - a)
    .map(([agentId]) => agentId)
    .filter((agentId) => agentId !== foregroundAgentId)
}

function decision(
  signal: ResourceGovernorDecision['signal'],
  severity: ResourceGovernorDecision['severity'],
  message: string,
  actions: ResourceGovernorAction[],
  affectedAgentIds: string[],
): ResourceGovernorDecision {
  return {
    signal,
    severity,
    message,
    actions,
    affectedAgentIds,
  }
}

function uniqueActions(decisions: ResourceGovernorDecision[]): ResourceGovernorAction[] {
  return Array.from(new Set(decisions.flatMap((decision) => decision.actions)))
}

function statusFromDecisions(decisions: ResourceGovernorDecision[]): ResourceGovernorStatus {
  if (decisions.some((decision) => decision.actions.includes('pause_low_priority') || decision.actions.includes('force_checkpoint'))) {
    return 'paused'
  }
  if (decisions.some((decision) => decision.actions.includes('notify_user'))) return 'needs_user'
  if (decisions.some((decision) => decision.actions.includes('throttle') || decision.actions.includes('reduce_concurrency'))) {
    return 'throttled'
  }
  return 'safe'
}

function calculateMaxConcurrentAgents(
  snapshot: ResourceGovernorSnapshot,
  policy: ResourceGovernorPolicy,
  decisions: ResourceGovernorDecision[],
): number {
  const current = Math.max(snapshot.activeAgentCount ?? 0, 1)
  if (snapshot.powerSource === 'battery') {
    return Math.min(current, policy.battery.maxConcurrentAgentsOnBattery)
  }
  if (decisions.some((decision) => decision.signal === 'thermal_pressure' || decision.signal === 'gpu_pressure')) {
    return Math.max(Math.floor(current * policy.priorities.backgroundAgentThrottle), 1)
  }
  if (decisions.some((decision) => decision.actions.includes('reduce_concurrency'))) {
    return Math.max(current - 1, 1)
  }
  return current
}

function recommendationFor(
  status: ResourceGovernorStatus,
  actions: ResourceGovernorAction[],
  maxConcurrentAgents: number,
): string {
  if (status === 'safe') return 'Resource usage is within policy; continue normal Agent execution.'
  if (actions.includes('force_checkpoint')) return 'Force checkpoints now and pause low-priority Agents until power recovers.'
  if (actions.includes('disable_local_llm')) return 'Disable local model inference, use cheaper/cloud models, and cap concurrency.'
  if (actions.includes('show_tray_resource_status')) return 'Show resource and temperature status in the tray and slow model/browser activity.'
  return `Apply resource pressure actions and cap concurrent Agents at ${maxConcurrentAgents}.`
}

async function getRequiredPolicy(id: string): Promise<ResourceGovernorPolicyRow> {
  const row = await db.query.resourceGovernorPolicies.findFirst({
    where: eq(schema.resourceGovernorPolicies.id, id),
  })
  if (!row) throw new Error(`Resource governor policy not found: ${id}`)
  return row
}
