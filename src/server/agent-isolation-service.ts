import { asc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  AgentWorkstationRow,
  ComputerSessionRow,
  JsonObject,
  ModelProfileRow,
  ResourceLockRow,
  ResourceType,
  SoftwareProfileRow,
  WorkstationMode,
} from '@/db/schema'

export type AgentIsolationVerdict =
  | 'isolated'
  | 'needs_lock'
  | 'conflict'
  | 'not_parallel_safe'

export interface AgentIsolationResourceRequirement {
  resourceType: ResourceType
  resourceId: string
  reason: string
  scope: 'agent' | 'shared' | 'runtime'
  blocksParallelism: boolean
}

export interface AgentIsolationLockConflict {
  resourceType: ResourceType
  resourceId: string
  ownerRunId: string
  ownerAgentId: string
  expiresAt: number
}

export interface AgentIsolationReport {
  agentProfile: Pick<AgentProfileRow, 'id' | 'name' | 'role' | 'status'>
  resolvedMode: WorkstationMode
  workstation: {
    configuredMode: WorkstationMode | null
    configuredWorkstations: Array<Pick<
      AgentWorkstationRow,
      | 'id'
      | 'mode'
      | 'workspacePath'
      | 'browserProfilePath'
      | 'tempPath'
      | 'displayId'
      | 'vncUrl'
      | 'rdpConfig'
      | 'status'
    >>
    profilePaths: {
      workspacePath: string
      browserProfilePath: string
      tempPath: string
    }
    activeSessions: Array<Pick<
      ComputerSessionRow,
      | 'id'
      | 'mode'
      | 'employeeRunId'
      | 'workflowRunId'
      | 'workspacePath'
      | 'browserProfilePath'
      | 'tempPath'
      | 'status'
      | 'updatedAt'
    >>
  }
  capabilities: {
    browser: boolean
    desktop: boolean
    mobile: boolean
    cli: boolean
    software: boolean
    fileRead: boolean
    fileWrite: boolean
    commandExecution: boolean
    network: boolean
  }
  environmentIsolation: {
    workspacePerAgent: boolean
    tempPerAgent: boolean
    browserProfilePerAgent: boolean
    cliProcessPerRun: boolean
    mcpConnectionPerAgent: boolean
    softwareProfiles: string[]
    networkProfileIds: string[]
  }
  resourceLocks: {
    required: AgentIsolationResourceRequirement[]
    heldConflicts: AgentIsolationLockConflict[]
    heldByAgent: AgentIsolationLockConflict[]
  }
  concurrency: {
    verdict: AgentIsolationVerdict
    parallelSafe: boolean
    trueParallelDesktopRequiresVirtualWorkstation: boolean
    v1Behavior: string
    v2UpgradePath: string
    reasons: string[]
    warnings: string[]
    recommendations: string[]
  }
  generatedAt: number
}

export async function getAgentIsolationReport(agentProfileId: string): Promise<AgentIsolationReport> {
  const agent = await getRequiredAgentProfile(agentProfileId)
  const [workstations, sessions, heldLocks, modelProfiles, softwareProfiles] = await Promise.all([
    listAgentWorkstations(agent.id),
    listActiveComputerSessions(agent.id),
    listHeldResourceLocks(),
    listModelProfilesForAgent(agent),
    listSoftwareProfilesForAgent(agent),
  ])
  const resolvedMode = resolveWorkstationMode(agent)
  const configuredMode = readWorkstationMode(agent.workstationPolicy.mode)
  const capabilities = resolveCapabilities(agent, resolvedMode)
  const profilePaths = resolveProfilePaths(agent.id, workstations[0])
  const networkProfileIds = uniqueStrings([
    ...modelProfiles.map((row) => row.networkProfileId ?? ''),
    readString(agent.workstationPolicy.networkProfileId),
    readString(agent.permissionPolicy.networkProfileId),
  ])
  const softwareProfileIds = softwareProfiles.map((row) => row.id)
  const requiredLocks = buildRequiredLocks({
    agent,
    resolvedMode,
    capabilities,
    softwareProfileIds,
    networkProfileIds,
  })
  const heldConflicts = heldLocks
    .filter((lock) => requiredLocks.some((required) =>
      required.resourceType === lock.resourceType &&
      required.resourceId === lock.resourceId &&
      lock.ownerAgentId !== agent.id,
    ))
    .map(lockConflictSummary)
  const heldByAgent = heldLocks
    .filter((lock) => lock.ownerAgentId === agent.id)
    .map(lockConflictSummary)
  const warnings = buildWarnings({
    agent,
    resolvedMode,
    configuredMode,
    capabilities,
    workstations,
    sessions,
    requiredLocks,
    heldByAgent,
  })
  const reasons = buildReasons({
    resolvedMode,
    capabilities,
    requiredLocks,
    heldConflicts,
    heldByAgent,
  })
  const recommendations = buildRecommendations({
    resolvedMode,
    capabilities,
    heldConflicts,
    heldByAgent,
    workstations,
  })
  const verdict = resolveVerdict({
    resolvedMode,
    capabilities,
    heldConflicts,
    heldByAgent,
  })
  return {
    agentProfile: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
    },
    resolvedMode,
    workstation: {
      configuredMode,
      configuredWorkstations: workstations.map(workstationSummary),
      profilePaths,
      activeSessions: sessions.map(sessionSummary),
    },
    capabilities,
    environmentIsolation: {
      workspacePerAgent: true,
      tempPerAgent: true,
      browserProfilePerAgent: capabilities.browser,
      cliProcessPerRun: capabilities.cli,
      mcpConnectionPerAgent: agent.mcpServerIds.length > 0,
      softwareProfiles: softwareProfileIds,
      networkProfileIds,
    },
    resourceLocks: {
      required: requiredLocks,
      heldConflicts,
      heldByAgent,
    },
    concurrency: {
      verdict,
      parallelSafe: verdict === 'isolated',
      trueParallelDesktopRequiresVirtualWorkstation: capabilities.desktop && resolvedMode === 'physical_desktop',
      v1Behavior: 'Browser, CLI, file workspace, and MCP work can run in isolated per-Agent contexts; physical desktop, mobile devices, and single-instance software are serialized with resource locks.',
      v2UpgradePath: 'Use virtual_desktop, vm, or remote_session workstations to let multiple desktop-operating Agents run at the same time without sharing the real mouse and keyboard.',
      reasons,
      warnings,
      recommendations,
    },
    generatedAt: Date.now(),
  }
}

async function getRequiredAgentProfile(id: string): Promise<AgentProfileRow> {
  const row = await db.query.agentProfiles.findFirst({ where: eq(schema.agentProfiles.id, id) })
  if (!row) throw new Error(`Agent profile not found: ${id}`)
  return row
}

async function listAgentWorkstations(agentProfileId: string): Promise<AgentWorkstationRow[]> {
  return db.query.agentWorkstations.findMany({
    where: eq(schema.agentWorkstations.agentProfileId, agentProfileId),
    orderBy: [asc(schema.agentWorkstations.createdAt)],
  })
}

async function listActiveComputerSessions(agentProfileId: string): Promise<ComputerSessionRow[]> {
  const sessions = await db.query.computerSessions.findMany({
    where: eq(schema.computerSessions.agentProfileId, agentProfileId),
    orderBy: [asc(schema.computerSessions.createdAt)],
  })
  return sessions.filter((session) => session.status === 'active' || session.status === 'paused')
}

async function listHeldResourceLocks(): Promise<ResourceLockRow[]> {
  return db.query.resourceLocks.findMany({
    where: eq(schema.resourceLocks.status, 'held'),
    orderBy: [asc(schema.resourceLocks.createdAt)],
  })
}

async function listModelProfilesForAgent(agent: AgentProfileRow): Promise<ModelProfileRow[]> {
  const ids = uniqueStrings([agent.modelProfileId ?? '', ...agent.fallbackModelProfileIds])
  if (!ids.length) return []
  return db.query.modelProfiles.findMany({
    where: (table, { inArray }) => inArray(table.id, ids),
    orderBy: [asc(schema.modelProfiles.name)],
  })
}

async function listSoftwareProfilesForAgent(agent: AgentProfileRow): Promise<SoftwareProfileRow[]> {
  const ids = uniqueStrings(agent.softwareProfileIds)
  if (!ids.length) return []
  return db.query.softwareProfiles.findMany({
    where: (table, { inArray }) => inArray(table.id, ids),
    orderBy: [asc(schema.softwareProfiles.name)],
  })
}

function resolveWorkstationMode(agent: AgentProfileRow): WorkstationMode {
  const configured = readWorkstationMode(agent.workstationPolicy.mode)
  if (configured) return configured
  if (readPolicyFlag(agent.permissionPolicy, 'canUseDesktop') || readNestedFlag(agent.permissionPolicy, ['desktop', 'operate'])) {
    return 'physical_desktop'
  }
  return 'browser_context'
}

function resolveCapabilities(
  agent: AgentProfileRow,
  resolvedMode: WorkstationMode,
): AgentIsolationReport['capabilities'] {
  const canUseBrowser =
    readPolicyFlag(agent.permissionPolicy, 'canUseBrowser') ||
    readNestedFlag(agent.permissionPolicy, ['browser', 'operate']) ||
    resolvedMode === 'browser_context'
  const canUseDesktop =
    readPolicyFlag(agent.permissionPolicy, 'canUseDesktop') ||
    readNestedFlag(agent.permissionPolicy, ['desktop', 'operate']) ||
    resolvedMode === 'physical_desktop' ||
    resolvedMode === 'virtual_desktop' ||
    resolvedMode === 'vm' ||
    resolvedMode === 'remote_session'
  return {
    browser: canUseBrowser,
    desktop: canUseDesktop,
    mobile:
      readPolicyFlag(agent.permissionPolicy, 'canUseMobile') ||
      readNestedFlag(agent.permissionPolicy, ['mobile', 'operate']),
    cli: agent.cliProfileIds.length > 0,
    software: agent.softwareProfileIds.length > 0,
    fileRead: readPolicyFlag(agent.permissionPolicy, 'canReadFiles'),
    fileWrite: readPolicyFlag(agent.permissionPolicy, 'canWriteFiles'),
    commandExecution: readPolicyFlag(agent.permissionPolicy, 'canRunCommands'),
    network:
      readPolicyFlag(agent.permissionPolicy, 'canUseNetwork') ||
      readPolicyFlag(agent.permissionPolicy, 'network') ||
      agent.mcpServerIds.length > 0,
  }
}

function buildRequiredLocks(args: {
  agent: AgentProfileRow
  resolvedMode: WorkstationMode
  capabilities: AgentIsolationReport['capabilities']
  softwareProfileIds: string[]
  networkProfileIds: string[]
}): AgentIsolationResourceRequirement[] {
  const locks: AgentIsolationResourceRequirement[] = [
    {
      resourceType: 'workspace_path',
      resourceId: `agent:${args.agent.id}:workspace`,
      reason: 'Each Agent run writes inside an Agent-scoped workspace path.',
      scope: 'agent',
      blocksParallelism: false,
    },
  ]
  if (args.capabilities.browser) {
    locks.push({
      resourceType: 'browser_profile',
      resourceId: `agent:${args.agent.id}:browser`,
      reason: 'Browser cookies, local storage, and session state must not be shared across Agents.',
      scope: 'agent',
      blocksParallelism: false,
    })
  }
  if (args.capabilities.desktop && args.resolvedMode === 'physical_desktop') {
    locks.push({
      resourceType: 'physical_mouse_keyboard',
      resourceId: 'default',
      reason: 'The real desktop has one mouse and keyboard, so live GUI control must be serialized in v1.',
      scope: 'shared',
      blocksParallelism: true,
    })
  }
  if (args.capabilities.mobile) {
    locks.push({
      resourceType: 'mobile_device',
      resourceId: readString(args.agent.workstationPolicy.mobileDeviceId) ?? 'default',
      reason: 'A physical or mirrored phone can only accept one automation controller at a time.',
      scope: 'shared',
      blocksParallelism: true,
    })
  }
  for (const softwareProfileId of args.softwareProfileIds) {
    locks.push({
      resourceType: 'software_instance',
      resourceId: `software:${softwareProfileId}`,
      reason: 'Software adapters may target a single app instance unless the profile later declares multi-instance support.',
      scope: 'shared',
      blocksParallelism: true,
    })
  }
  for (const networkProfileId of args.networkProfileIds) {
    locks.push({
      resourceType: 'network_profile',
      resourceId: `network:${networkProfileId}`,
      reason: 'Network egress profile is tracked so routing, proxy, and cost attribution remain explainable.',
      scope: 'runtime',
      blocksParallelism: false,
    })
  }
  return dedupeLocks(locks)
}

function resolveVerdict(args: {
  resolvedMode: WorkstationMode
  capabilities: AgentIsolationReport['capabilities']
  heldConflicts: AgentIsolationLockConflict[]
  heldByAgent: AgentIsolationLockConflict[]
}): AgentIsolationVerdict {
  if (args.heldConflicts.length > 0) return 'conflict'
  if (
    args.heldByAgent.some((lock) =>
      lock.resourceType === 'physical_mouse_keyboard' ||
      lock.resourceType === 'mobile_device' ||
      lock.resourceType === 'software_instance',
    )
  ) {
    return 'not_parallel_safe'
  }
  if (
    (args.capabilities.desktop && args.resolvedMode === 'physical_desktop') ||
    args.capabilities.mobile
  ) {
    return 'needs_lock'
  }
  return 'isolated'
}

function buildReasons(args: {
  resolvedMode: WorkstationMode
  capabilities: AgentIsolationReport['capabilities']
  requiredLocks: AgentIsolationResourceRequirement[]
  heldConflicts: AgentIsolationLockConflict[]
  heldByAgent: AgentIsolationLockConflict[]
}): string[] {
  const reasons: string[] = [
    `Resolved workstation mode: ${args.resolvedMode}.`,
    `Required resource locks: ${args.requiredLocks.map((lock) => `${lock.resourceType}:${lock.resourceId}`).join(', ')}.`,
  ]
  if (args.capabilities.browser) {
    reasons.push('Browser work is isolated with an Agent-scoped browser profile.')
  }
  if (args.capabilities.cli) {
    reasons.push('CLI work is run as per-run processes and should use the Agent workspace as cwd.')
  }
  if (args.heldConflicts.length) {
    reasons.push('One or more required resources are already held by another Agent/run.')
  }
  if (args.heldByAgent.length) {
    reasons.push('This Agent already owns held locks; a second run may collide with its own shared resources.')
  }
  if (args.capabilities.desktop && args.resolvedMode === 'physical_desktop') {
    reasons.push('Physical desktop control is serialized in v1 because it shares the real mouse and keyboard.')
  }
  return reasons
}

function buildWarnings(args: {
  agent: AgentProfileRow
  resolvedMode: WorkstationMode
  configuredMode: WorkstationMode | null
  capabilities: AgentIsolationReport['capabilities']
  workstations: AgentWorkstationRow[]
  sessions: ComputerSessionRow[]
  requiredLocks: AgentIsolationResourceRequirement[]
  heldByAgent: AgentIsolationLockConflict[]
}): string[] {
  const warnings: string[] = []
  if (!args.configuredMode) {
    warnings.push('Workstation mode is implicit; set workstationPolicy.mode to make isolation behavior explicit.')
  }
  if (args.capabilities.desktop && args.resolvedMode === 'physical_desktop') {
    warnings.push('Physical desktop operation cannot run in true parallel with another physical-desktop Agent in v1.')
  }
  if (
    (args.resolvedMode === 'virtual_desktop' || args.resolvedMode === 'vm' || args.resolvedMode === 'remote_session') &&
    args.workstations.length === 0
  ) {
    warnings.push('Virtual/remote workstation mode is selected but no workstation record is registered yet.')
  }
  if (args.capabilities.software && !args.capabilities.commandExecution) {
    warnings.push('Software profiles are selected but command execution permission is not declared.')
  }
  if (args.sessions.length > 0) {
    warnings.push(`${args.sessions.length} active/paused computer session(s) already exist for this Agent.`)
  }
  if (args.heldByAgent.length > 0) {
    warnings.push('This Agent already has held resource locks; inspect the owning run before starting another run.')
  }
  if (!args.requiredLocks.some((lock) => lock.resourceType === 'browser_profile') && args.capabilities.browser) {
    warnings.push('Browser capability is enabled but no browser profile lock was planned.')
  }
  return warnings
}

function buildRecommendations(args: {
  resolvedMode: WorkstationMode
  capabilities: AgentIsolationReport['capabilities']
  heldConflicts: AgentIsolationLockConflict[]
  heldByAgent: AgentIsolationLockConflict[]
  workstations: AgentWorkstationRow[]
}): string[] {
  const recommendations: string[] = []
  if (args.heldConflicts.length > 0) {
    recommendations.push('Wait for the conflicting run to release its locks or route this Agent to a different workstation/resource.')
  }
  if (args.heldByAgent.length > 0) {
    recommendations.push('Resume, cancel, or complete the existing run before launching another run that needs the same shared resource.')
  }
  if (args.capabilities.desktop && args.resolvedMode === 'physical_desktop') {
    recommendations.push('Keep physical desktop actions behind a resource lock; upgrade to virtual_desktop, vm, or remote_session for real parallel desktop work.')
  }
  if (
    (args.resolvedMode === 'virtual_desktop' || args.resolvedMode === 'vm' || args.resolvedMode === 'remote_session') &&
    args.workstations.length === 0
  ) {
    recommendations.push('Register an Agent workstation record with display/VNC/RDP metadata before enabling unattended desktop execution.')
  }
  if (!recommendations.length) {
    recommendations.push('This Agent can be scheduled in parallel for browser/CLI/workspace work; continue to acquire locks at run time.')
  }
  return recommendations
}

function resolveProfilePaths(
  agentProfileId: string,
  workstation?: AgentWorkstationRow,
): AgentIsolationReport['workstation']['profilePaths'] {
  if (workstation) {
    return {
      workspacePath: workstation.workspacePath,
      browserProfilePath: workstation.browserProfilePath,
      tempPath: workstation.tempPath,
    }
  }
  const safeId = agentProfileId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return {
    workspacePath: `.agenthub-data/employee-workspaces/${safeId}`,
    browserProfilePath: `.agenthub-data/browser-profiles/${safeId}`,
    tempPath: `.agenthub-data/tmp/${safeId}`,
  }
}

function workstationSummary(workstation: AgentWorkstationRow): AgentIsolationReport['workstation']['configuredWorkstations'][number] {
  return {
    id: workstation.id,
    mode: workstation.mode,
    workspacePath: workstation.workspacePath,
    browserProfilePath: workstation.browserProfilePath,
    tempPath: workstation.tempPath,
    displayId: workstation.displayId,
    vncUrl: workstation.vncUrl,
    rdpConfig: workstation.rdpConfig,
    status: workstation.status,
  }
}

function sessionSummary(session: ComputerSessionRow): AgentIsolationReport['workstation']['activeSessions'][number] {
  return {
    id: session.id,
    mode: session.mode,
    employeeRunId: session.employeeRunId,
    workflowRunId: session.workflowRunId,
    workspacePath: session.workspacePath,
    browserProfilePath: session.browserProfilePath,
    tempPath: session.tempPath,
    status: session.status,
    updatedAt: session.updatedAt,
  }
}

function lockConflictSummary(lock: ResourceLockRow): AgentIsolationLockConflict {
  return {
    resourceType: lock.resourceType,
    resourceId: lock.resourceId,
    ownerRunId: lock.ownerRunId,
    ownerAgentId: lock.ownerAgentId,
    expiresAt: lock.expiresAt,
  }
}

function dedupeLocks(locks: AgentIsolationResourceRequirement[]): AgentIsolationResourceRequirement[] {
  const seen = new Set<string>()
  const unique: AgentIsolationResourceRequirement[] = []
  for (const lock of locks) {
    const key = `${lock.resourceType}:${lock.resourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(lock)
  }
  return unique
}

function readWorkstationMode(value: unknown): WorkstationMode | null {
  return value === 'browser_context' ||
    value === 'physical_desktop' ||
    value === 'virtual_desktop' ||
    value === 'vm' ||
    value === 'remote_session'
    ? value
    : null
}

function readPolicyFlag(policy: JsonObject, key: string): boolean {
  return policy[key] === true || policy[key] === 'true' || policy[key] === 'allowed'
}

function readNestedFlag(policy: JsonObject, path: string[]): boolean {
  let current: unknown = policy
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return false
    current = (current as Record<string, unknown>)[key]
  }
  return current === true || current === 'true' || current === 'allowed'
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? '').filter(Boolean))]
}
