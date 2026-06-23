import { and, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  ComputerSessionStatus,
  DataMaintenancePolicy,
  DataMaintenancePolicyRow,
  DataMaintenancePolicyStatus,
  DataMaintenanceRunRow,
  DataMaintenanceRunStatus,
  JsonObject,
  RunStatus,
} from '@/db/schema'
import { newDataMaintenancePolicyId, newDataMaintenanceRunId } from '@/server/ids'

export interface CreateDataMaintenancePolicyArgs {
  name?: string
  status?: DataMaintenancePolicyStatus
  policy?: PartialDataMaintenancePolicy
}

export interface ObservedBrowserProfile {
  profilePath: string
  sizeBytes: number
  lastUsedAt?: number
  agentProfileId?: string | null
}

export interface RunDataMaintenanceArgs {
  policyId?: string
  now?: number
  observedBrowserProfiles?: ObservedBrowserProfile[]
}

type PartialDataMaintenancePolicy = {
  logRotation?: Partial<DataMaintenancePolicy['logRotation']>
  sqliteMaintenance?: Partial<DataMaintenancePolicy['sqliteMaintenance']>
  workspaceGc?: Partial<DataMaintenancePolicy['workspaceGc']>
  browserProfiles?: Partial<DataMaintenancePolicy['browserProfiles']>
}

const DEFAULT_POLICY_NAME = 'Default data maintenance policy'

const defaultPolicy: DataMaintenancePolicy = {
  logRotation: {
    maxEventsPerRun: 500,
    olderThanDays: 90,
    archiveStrategy: 'summarize',
  },
  sqliteMaintenance: {
    schedule: 'weekly_sunday_03_00',
    operations: ['backup', 'integrity_check', 'ANALYZE', 'VACUUM', 'REINDEX'],
  },
  workspaceGc: {
    trashRetentionDays: 30,
    cleanRunTempForStatuses: ['complete', 'failed', 'aborted'],
    removeEmptyDirs: true,
    cleanBrowserSessionResidue: true,
    preserve: ['artifacts', 'runtime_checkpoints', 'agent_long_term_work_files'],
  },
  browserProfiles: {
    clearCacheOnTaskEnd: true,
    keepCookies: true,
    warnSizeBytes: 500 * 1024 * 1024,
    archiveInactiveDays: 30,
  },
}

export async function seedDataMaintenancePolicy(): Promise<DataMaintenancePolicyRow> {
  const existing = await db.query.dataMaintenancePolicies.findFirst({
    where: eq(schema.dataMaintenancePolicies.name, DEFAULT_POLICY_NAME),
  })
  if (existing) return existing
  return createDataMaintenancePolicy({ name: DEFAULT_POLICY_NAME })
}

export async function createDataMaintenancePolicy(
  args: CreateDataMaintenancePolicyArgs = {},
): Promise<DataMaintenancePolicyRow> {
  const now = Date.now()
  const row: DataMaintenancePolicyRow = {
    id: newDataMaintenancePolicyId(),
    name: args.name ?? `Data maintenance ${new Date(now).toISOString()}`,
    policy: mergePolicy(args.policy),
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.dataMaintenancePolicies).values(row)
  return row
}

export async function listDataMaintenancePolicies(args: {
  status?: DataMaintenancePolicyStatus
  limit?: number
} = {}): Promise<DataMaintenancePolicyRow[]> {
  const filters: SQL[] = []
  if (args.status) filters.push(eq(schema.dataMaintenancePolicies.status, args.status))
  return db.query.dataMaintenancePolicies.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.dataMaintenancePolicies.updatedAt)],
    limit: Math.min(Math.max(args.limit ?? 25, 1), 100),
  })
}

export async function runDataMaintenance(
  args: RunDataMaintenanceArgs = {},
): Promise<DataMaintenanceRunRow> {
  const policy = args.policyId ? await getRequiredPolicy(args.policyId) : await seedDataMaintenancePolicy()
  if (policy.status !== 'active') throw new Error(`Data maintenance policy is ${policy.status}: ${policy.id}`)
  const now = args.now ?? Date.now()
  const logRotationResult = await evaluateLogRotation(policy.policy, now)
  const sqliteMaintenanceResult = evaluateSqliteMaintenance(policy.policy)
  const workspaceGcResult = await evaluateWorkspaceGc(policy.policy, now)
  const browserProfileResult = await evaluateBrowserProfiles(
    policy.policy,
    now,
    args.observedBrowserProfiles ?? [],
  )
  const status = statusFromResults([
    logRotationResult,
    sqliteMaintenanceResult,
    workspaceGcResult,
    browserProfileResult,
  ])
  const row: DataMaintenanceRunRow = {
    id: newDataMaintenanceRunId(),
    policyId: policy.id,
    status,
    logRotationResult,
    sqliteMaintenanceResult,
    workspaceGcResult,
    browserProfileResult,
    createdAt: now,
    completedAt: now,
  }
  await db.insert(schema.dataMaintenanceRuns).values(row)
  return row
}

export async function listDataMaintenanceRuns(args: {
  policyId?: string
  status?: DataMaintenanceRunStatus
  limit?: number
} = {}): Promise<DataMaintenanceRunRow[]> {
  const filters: SQL[] = []
  if (args.policyId) filters.push(eq(schema.dataMaintenanceRuns.policyId, args.policyId))
  if (args.status) filters.push(eq(schema.dataMaintenanceRuns.status, args.status))
  return db.query.dataMaintenanceRuns.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(schema.dataMaintenanceRuns.createdAt)],
    limit: Math.min(Math.max(args.limit ?? 50, 1), 200),
  })
}

async function evaluateLogRotation(
  policy: DataMaintenancePolicy,
  now: number,
): Promise<JsonObject> {
  const events = await db.query.employeeRunEvents.findMany({
    orderBy: [desc(schema.employeeRunEvents.createdAt)],
    limit: 5000,
  })
  const cutoffAt = now - policy.logRotation.olderThanDays * 24 * 60 * 60 * 1000
  const perRun = new Map<string, number>()
  for (const event of events) perRun.set(event.employeeRunId, (perRun.get(event.employeeRunId) ?? 0) + 1)
  const overLimitRuns = Array.from(perRun.entries())
    .filter(([, count]) => count > policy.logRotation.maxEventsPerRun)
    .map(([employeeRunId, eventCount]) => ({ employeeRunId, eventCount }))
  const oldEventCount = events.filter((event) => event.createdAt < cutoffAt).length
  return {
    status: overLimitRuns.length > 0 || oldEventCount > 0 ? 'warning' : 'ok',
    recordOnly: true,
    maxEventsPerRun: policy.logRotation.maxEventsPerRun,
    olderThanDays: policy.logRotation.olderThanDays,
    archiveStrategy: policy.logRotation.archiveStrategy,
    oldEventCount,
    overLimitRuns,
    plannedAction:
      policy.logRotation.archiveStrategy === 'summarize'
        ? 'summarize_old_events_and_keep_step_statistics'
        : policy.logRotation.archiveStrategy,
  }
}

function evaluateSqliteMaintenance(policy: DataMaintenancePolicy): JsonObject {
  return {
    status: 'ok',
    recordOnly: true,
    schedule: policy.sqliteMaintenance.schedule,
    operations: policy.sqliteMaintenance.operations,
    backupBeforeMaintenance: policy.sqliteMaintenance.operations.includes('backup'),
    notes: 'Existing maintenance windows execute SQLite integrity_check, ANALYZE, and VACUUM; this run records the scheduled plan including REINDEX.',
  }
}

async function evaluateWorkspaceGc(
  policy: DataMaintenancePolicy,
  now: number,
): Promise<JsonObject> {
  const sessions = await db.query.computerSessions.findMany({
    orderBy: [desc(schema.computerSessions.createdAt)],
    limit: 500,
  })
  const terminalSessions = sessions.filter((session) => {
    if (!session.finishedAt) return false
    return policy.workspaceGc.cleanRunTempForStatuses.includes(
      runStatusFromComputerSessionStatus(session.status),
    )
  })
  return {
    status: 'ok',
    recordOnly: true,
    runTempCandidateCount: terminalSessions.length,
    tempPaths: terminalSessions.map((session) => session.tempPath),
    trashRetentionDays: policy.workspaceGc.trashRetentionDays,
    removeEmptyDirs: policy.workspaceGc.removeEmptyDirs,
    cleanBrowserSessionResidue: policy.workspaceGc.cleanBrowserSessionResidue,
    preserve: policy.workspaceGc.preserve,
    evaluatedAt: now,
  }
}

async function evaluateBrowserProfiles(
  policy: DataMaintenancePolicy,
  now: number,
  observed: ObservedBrowserProfile[],
): Promise<JsonObject> {
  const sessions = await db.query.computerSessions.findMany({
    orderBy: [desc(schema.computerSessions.createdAt)],
    limit: 500,
  })
  const observedByPath = new Map(observed.map((profile) => [profile.profilePath, profile]))
  const profilePaths = Array.from(new Set(sessions.map((session) => session.browserProfilePath)))
  const largeProfiles = observed.filter((profile) => profile.sizeBytes > policy.browserProfiles.warnSizeBytes)
  const inactiveCutoff = now - policy.browserProfiles.archiveInactiveDays * 24 * 60 * 60 * 1000
  const archiveCandidates = observed.filter((profile) => (profile.lastUsedAt ?? now) < inactiveCutoff)
  return {
    status: largeProfiles.length > 0 || archiveCandidates.length > 0 ? 'warning' : 'ok',
    recordOnly: true,
    clearCacheOnTaskEnd: policy.browserProfiles.clearCacheOnTaskEnd,
    keepCookies: policy.browserProfiles.keepCookies,
    warnSizeBytes: policy.browserProfiles.warnSizeBytes,
    archiveInactiveDays: policy.browserProfiles.archiveInactiveDays,
    knownProfileCount: profilePaths.length,
    profilesWithoutObservedSize: profilePaths.filter((profilePath) => !observedByPath.has(profilePath)),
    largeProfiles,
    archiveCandidates,
  }
}

function mergePolicy(patch: PartialDataMaintenancePolicy | undefined): DataMaintenancePolicy {
  return {
    logRotation: {
      ...defaultPolicy.logRotation,
      ...patch?.logRotation,
    },
    sqliteMaintenance: {
      ...defaultPolicy.sqliteMaintenance,
      ...patch?.sqliteMaintenance,
      operations: patch?.sqliteMaintenance?.operations ?? defaultPolicy.sqliteMaintenance.operations,
    },
    workspaceGc: {
      ...defaultPolicy.workspaceGc,
      ...patch?.workspaceGc,
      cleanRunTempForStatuses:
        patch?.workspaceGc?.cleanRunTempForStatuses ?? defaultPolicy.workspaceGc.cleanRunTempForStatuses,
      preserve: patch?.workspaceGc?.preserve ?? defaultPolicy.workspaceGc.preserve,
    },
    browserProfiles: {
      ...defaultPolicy.browserProfiles,
      ...patch?.browserProfiles,
    },
  }
}

function statusFromResults(results: JsonObject[]): DataMaintenanceRunStatus {
  if (results.some((result) => result.status === 'failed')) return 'failed'
  if (results.some((result) => result.status === 'warning')) return 'warning'
  return 'completed'
}

function runStatusFromComputerSessionStatus(status: ComputerSessionStatus): RunStatus {
  if (status === 'active') return 'running'
  if (status === 'complete') return 'complete'
  if (status === 'failed') return 'failed'
  return 'paused'
}

async function getRequiredPolicy(id: string): Promise<DataMaintenancePolicyRow> {
  const row = await db.query.dataMaintenancePolicies.findFirst({
    where: eq(schema.dataMaintenancePolicies.id, id),
  })
  if (!row) throw new Error(`Data maintenance policy not found: ${id}`)
  return row
}
