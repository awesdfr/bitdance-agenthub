import { existsSync, mkdirSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'

import { desc, eq, inArray } from 'drizzle-orm'

import { db, schema, sqlite } from '@/db/client'
import type {
  JsonObject,
  MaintenanceWindowRow,
  UpdateAgentsRunningStrategy,
  UpdateChannel,
  UpdateCheckInterval,
  UpdateInstallMode,
  UpdatePolicyRow,
} from '@/db/schema'
import { newMaintenanceWindowId, newUpdatePolicyId } from '@/server/ids'
import { createNotification } from '@/server/notification-service'
import { recordAuditLog } from '@/server/security-service'

const DEFAULT_MAX_WAIT_MS = 2 * 60 * 60 * 1000

export interface SaveUpdatePolicyArgs {
  name?: string
  checkInterval?: UpdateCheckInterval
  channel?: UpdateChannel
  autoDownload?: boolean
  installOn?: UpdateInstallMode
  ifAgentsRunning?: UpdateAgentsRunningStrategy
  maxWaitMs?: number
  rollbackCrashOnStartup?: boolean
  rollbackAgentSuccessRateDrop?: number
}

export interface UpdateCheckResult extends JsonObject {
  currentVersion: string
  availableVersion: string | null
  updateAvailable: boolean
  channel: UpdateChannel
  autoDownload: boolean
  installOn: UpdateInstallMode
  agentsRunning: number
  agentsQueued: number
  ifAgentsRunning: UpdateAgentsRunningStrategy
  updateAction: string
  releaseNotes: string
  checkedAt: number
  notificationId?: string
}

export interface MaintenanceState {
  updatePolicy: UpdatePolicyRow
  activeMaintenanceWindow: MaintenanceWindowRow | null
  recentMaintenanceWindows: MaintenanceWindowRow[]
  canStartNewTasks: boolean
}

export async function getUpdatePolicy(): Promise<UpdatePolicyRow> {
  const existing = await db.query.updatePolicies.findFirst({
    orderBy: [desc(schema.updatePolicies.updatedAt)],
  })
  if (existing) return existing

  const now = Date.now()
  const row: UpdatePolicyRow = {
    id: newUpdatePolicyId(),
    name: 'Default update policy',
    checkInterval: 'daily',
    channel: 'stable',
    autoDownload: true,
    installOn: 'ask_user',
    ifAgentsRunning: 'notify_user',
    maxWaitMs: DEFAULT_MAX_WAIT_MS,
    rollbackCrashOnStartup: true,
    rollbackAgentSuccessRateDrop: 20,
    lastCheckedAt: null,
    lastCheckResult: {},
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.updatePolicies).values(row)
  return row
}

export async function saveUpdatePolicy(args: SaveUpdatePolicyArgs): Promise<UpdatePolicyRow> {
  const existing = await getUpdatePolicy()
  const now = Date.now()
  await db
    .update(schema.updatePolicies)
    .set({
      name: args.name?.trim() || existing.name,
      checkInterval: args.checkInterval ?? existing.checkInterval,
      channel: args.channel ?? existing.channel,
      autoDownload: args.autoDownload ?? existing.autoDownload,
      installOn: args.installOn ?? existing.installOn,
      ifAgentsRunning: args.ifAgentsRunning ?? existing.ifAgentsRunning,
      maxWaitMs: args.maxWaitMs ?? existing.maxWaitMs,
      rollbackCrashOnStartup: args.rollbackCrashOnStartup ?? existing.rollbackCrashOnStartup,
      rollbackAgentSuccessRateDrop:
        args.rollbackAgentSuccessRateDrop ?? existing.rollbackAgentSuccessRateDrop,
      updatedAt: now,
    })
    .where(eq(schema.updatePolicies.id, existing.id))
  await recordAuditLog({
    actorType: 'system',
    action: 'maintenance.update_policy.save',
    resourceType: 'update_policy',
    resourceId: existing.id,
    status: 'allowed',
    riskLevel: 'low',
    message: 'Update policy was saved.',
    metadata: { channel: args.channel ?? existing.channel, installOn: args.installOn ?? existing.installOn },
  })
  return getUpdatePolicy()
}

export async function checkForApplicationUpdate(args: {
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  now?: number
}): Promise<{ updatePolicy: UpdatePolicyRow; result: UpdateCheckResult }> {
  const policy = await getUpdatePolicy()
  const now = args.now ?? Date.now()
  const counts = await countAgentRuns()
  const availableVersion = args.availableVersion?.trim() || null
  const updateAvailable = availableVersion
    ? compareVersionStrings(availableVersion, args.currentVersion) > 0
    : false

  let updateAction = updateAvailable
    ? policy.autoDownload
      ? 'download_in_background'
      : 'notify_only'
    : 'none'
  let notificationId: string | undefined
  if (updateAvailable && counts.running + counts.queued > 0) {
    updateAction = actionForRunningAgents(policy.ifAgentsRunning)
    if (policy.ifAgentsRunning === 'notify_user') {
      const notification = await createNotification({
        channel: 'in_app',
        level: 'info',
        sourceType: 'update_policy',
        sourceId: policy.id,
        title: `Update available: ${availableVersion}`,
        message: 'Agents are active, so the updater is waiting for user timing.',
        payload: {
          currentVersion: args.currentVersion,
          availableVersion,
          runningAgentCount: counts.running,
          queuedAgentCount: counts.queued,
        },
      })
      notificationId = notification.id
    }
  }

  const result: UpdateCheckResult = {
    currentVersion: args.currentVersion,
    availableVersion,
    updateAvailable,
    channel: policy.channel,
    autoDownload: policy.autoDownload,
    installOn: policy.installOn,
    agentsRunning: counts.running,
    agentsQueued: counts.queued,
    ifAgentsRunning: policy.ifAgentsRunning,
    updateAction,
    releaseNotes: args.releaseNotes?.trim() ?? '',
    checkedAt: now,
    ...(notificationId ? { notificationId } : {}),
  }

  await db
    .update(schema.updatePolicies)
    .set({ lastCheckedAt: now, lastCheckResult: result, updatedAt: now })
    .where(eq(schema.updatePolicies.id, policy.id))
  await recordAuditLog({
    actorType: 'system',
    action: 'maintenance.update_check',
    resourceType: 'update_policy',
    resourceId: policy.id,
    status: updateAvailable ? 'warning' : 'allowed',
    riskLevel: updateAvailable ? 'medium' : 'low',
    message: updateAvailable ? `Update ${availableVersion} is available.` : 'No update is available.',
    metadata: result,
  })
  return { updatePolicy: await getUpdatePolicy(), result }
}

export async function getMaintenanceState(): Promise<MaintenanceState> {
  const updatePolicy = await getUpdatePolicy()
  const activeMaintenanceWindow = await getActiveMaintenanceWindow()
  const recentMaintenanceWindows = await listMaintenanceWindows(10)
  return {
    updatePolicy,
    activeMaintenanceWindow,
    recentMaintenanceWindows,
    canStartNewTasks: !activeMaintenanceWindow,
  }
}

export async function listMaintenanceWindows(limit = 50): Promise<MaintenanceWindowRow[]> {
  return db.query.maintenanceWindows.findMany({
    orderBy: [desc(schema.maintenanceWindows.createdAt)],
    limit,
  })
}

export async function getActiveMaintenanceWindow(): Promise<MaintenanceWindowRow | null> {
  return (
    (await db.query.maintenanceWindows.findFirst({
      where: eq(schema.maintenanceWindows.status, 'active'),
      orderBy: [desc(schema.maintenanceWindows.createdAt)],
    })) ?? null
  )
}

export async function assertCanStartNewAgentTask(): Promise<void> {
  const active = await getActiveMaintenanceWindow()
  if (!active) return
  throw new Error(`Maintenance mode is active: ${active.reason}`)
}

export async function startMaintenanceWindow(args: {
  reason?: string
  updatePolicyId?: string | null
  autoComplete?: boolean
  now?: number
} = {}): Promise<MaintenanceWindowRow> {
  const active = await getActiveMaintenanceWindow()
  if (active) throw new Error(`Maintenance window already active: ${active.id}`)
  const policy = args.updatePolicyId
    ? await getUpdatePolicyById(args.updatePolicyId)
    : await getUpdatePolicy()
  const now = args.now ?? Date.now()
  const counts = await countAgentRuns()
  const row: MaintenanceWindowRow = {
    id: newMaintenanceWindowId(),
    updatePolicyId: policy.id,
    reason: args.reason?.trim() || 'Scheduled maintenance',
    status: 'active',
    blockedNewTasks: true,
    runningAgentCount: counts.running,
    queuedAgentCount: counts.queued,
    dbMaintenanceResult: { status: 'pending' },
    tempCleanupResult: { status: 'pending' },
    integrityCheckResult: { status: 'pending' },
    serviceRestartResult: { status: 'pending' },
    notificationId: null,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  }
  await db.insert(schema.maintenanceWindows).values(row)
  await recordAuditLog({
    actorType: 'system',
    action: 'maintenance.window.start',
    resourceType: 'maintenance_window',
    resourceId: row.id,
    status: 'warning',
    riskLevel: 'medium',
    message: 'Maintenance mode started; new Agent tasks are blocked.',
    metadata: {
      reason: row.reason,
      runningAgentCount: row.runningAgentCount,
      queuedAgentCount: row.queuedAgentCount,
    },
  })
  if (args.autoComplete === false) return getRequiredMaintenanceWindow(row.id)
  return completeMaintenanceWindow(row.id)
}

export async function completeMaintenanceWindow(
  id: string,
  _args: { force?: boolean; now?: number } = {},
): Promise<MaintenanceWindowRow> {
  const existing = await getRequiredMaintenanceWindow(id)
  if (existing.status === 'completed') return existing
  const now = _args.now ?? Date.now()
  const integrityCheckResult = runIntegrityCheck()
  const dbMaintenanceResult = runDatabaseMaintenance()
  const tempCleanupResult = cleanupAppTempFiles()
  const serviceRestartResult: JsonObject = {
    status: 'recorded',
    restarted: false,
    restartMode: 'deferred_to_desktop_shell',
    note: 'Electron services should restart after updater handoff or user-approved relaunch.',
  }
  const failed = [integrityCheckResult, dbMaintenanceResult, tempCleanupResult].some(
    (result) => result.status === 'failed',
  )
  const notification = await createNotification({
    channel: 'in_app',
    level: failed ? 'critical' : 'info',
    sourceType: 'maintenance_window',
    sourceId: existing.id,
    title: failed ? 'Maintenance needs attention' : 'Maintenance complete',
    message: failed
      ? 'Maintenance finished with at least one failed step.'
      : 'Maintenance completed and Agent task intake is open again.',
    payload: {
      integrityCheckResult,
      dbMaintenanceResult,
      tempCleanupResult,
      serviceRestartResult,
    },
  })

  await db
    .update(schema.maintenanceWindows)
    .set({
      status: failed ? 'failed' : 'completed',
      dbMaintenanceResult,
      tempCleanupResult,
      integrityCheckResult,
      serviceRestartResult,
      notificationId: notification.id,
      updatedAt: now,
      completedAt: now,
    })
    .where(eq(schema.maintenanceWindows.id, existing.id))
  await recordAuditLog({
    actorType: 'system',
    action: 'maintenance.window.complete',
    resourceType: 'maintenance_window',
    resourceId: existing.id,
    status: failed ? 'blocked' : 'allowed',
    riskLevel: failed ? 'high' : 'low',
    message: failed ? 'Maintenance completed with failed steps.' : 'Maintenance completed successfully.',
    metadata: {
      notificationId: notification.id,
      integrityCheckResult,
      dbMaintenanceResult,
      tempCleanupResult,
    },
  })
  return getRequiredMaintenanceWindow(existing.id)
}

async function getUpdatePolicyById(id: string): Promise<UpdatePolicyRow> {
  const row = await db.query.updatePolicies.findFirst({
    where: eq(schema.updatePolicies.id, id),
  })
  if (!row) throw new Error(`Update policy not found: ${id}`)
  return row
}

async function getRequiredMaintenanceWindow(id: string): Promise<MaintenanceWindowRow> {
  const row = await db.query.maintenanceWindows.findFirst({
    where: eq(schema.maintenanceWindows.id, id),
  })
  if (!row) throw new Error(`Maintenance window not found: ${id}`)
  return row
}

async function countAgentRuns(): Promise<{ running: number; queued: number }> {
  const runs = await db.query.employeeRuns.findMany({
    where: inArray(schema.employeeRuns.status, ['running', 'queued']),
  })
  return {
    running: runs.filter((run) => run.status === 'running').length,
    queued: runs.filter((run) => run.status === 'queued').length,
  }
}

function runIntegrityCheck(): JsonObject {
  try {
    const rows = sqlite.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>
    const values = rows.flatMap((row) => Object.values(row).map(String))
    return {
      status: values.every((value) => value.toLowerCase() === 'ok') ? 'ok' : 'warning',
      results: values,
    }
  } catch (err) {
    return { status: 'failed', error: errorMessage(err) }
  }
}

function runDatabaseMaintenance(): JsonObject {
  try {
    sqlite.exec('ANALYZE')
    sqlite.exec('VACUUM')
    return { status: 'ok', operations: ['ANALYZE', 'VACUUM'] }
  } catch (err) {
    return { status: 'failed', operations: ['ANALYZE', 'VACUUM'], error: errorMessage(err) }
  }
}

function cleanupAppTempFiles(): JsonObject {
  const dataDir = path.resolve(
    process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data'),
  )
  const tempDir = path.resolve(dataDir, 'tmp')
  if (!isPathInside(tempDir, dataDir)) {
    return { status: 'failed', error: 'Resolved temp directory is outside app data.' }
  }
  mkdirSync(tempDir, { recursive: true })
  const deleted = deleteFilesInside(tempDir, tempDir)
  return {
    status: 'ok',
    tempDir,
    filesDeleted: deleted.filesDeleted,
    bytesFreed: deleted.bytesFreed,
  }
}

function deleteFilesInside(rootDir: string, currentDir: string): { filesDeleted: number; bytesFreed: number } {
  let filesDeleted = 0
  let bytesFreed = 0
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const target = path.resolve(currentDir, entry.name)
    if (!isPathInside(target, rootDir)) continue
    if (entry.isDirectory()) {
      const nested = deleteFilesInside(rootDir, target)
      filesDeleted += nested.filesDeleted
      bytesFreed += nested.bytesFreed
      if (target !== rootDir && isDirectoryEmpty(target)) rmdirSync(target)
      continue
    }
    if (!entry.isFile()) continue
    const size = statSync(target).size
    unlinkSync(target)
    filesDeleted += 1
    bytesFreed += size
  }
  return { filesDeleted, bytesFreed }
}

function isDirectoryEmpty(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).length === 0
}

function isPathInside(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function actionForRunningAgents(strategy: UpdateAgentsRunningStrategy): string {
  if (strategy === 'wait_for_completion') return 'wait_for_agent_completion'
  if (strategy === 'force_after_timeout') return 'force_after_timeout'
  return 'notify_user'
}

function compareVersionStrings(left: string, right: string): number {
  const leftParts = left.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = right.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index++) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
