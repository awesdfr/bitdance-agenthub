import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { HealthStatus, JsonObject, McpServerRow } from '@/db/schema'
import { recordAuditLog } from '@/server/security-service'

export const MCP_PROCESS_ENABLE_ENV = 'AGENTHUB_ENABLE_REAL_MCP_PROCESS'
export const MCP_COMMAND_ALLOWLIST_ENV = 'AGENTHUB_ALLOWED_MCP_COMMANDS'
export const MCP_ENDPOINT_HOST_ALLOWLIST_ENV = 'AGENTHUB_ALLOWED_MCP_ENDPOINT_HOSTS'

export type McpRuntimeAction = 'plan' | 'start' | 'stop' | 'status'
export type McpRuntimeStatus = 'planned' | 'ready' | 'running' | 'stopped' | 'blocked' | 'failed'

export interface McpRuntimeOptions {
  live?: boolean
  confirmRisk?: boolean
}

export interface McpRuntimePlan {
  mcpServerId: string
  displayName: string
  transport: McpServerRow['transport']
  status: 'ready' | 'blocked'
  command: string | null
  args: string[]
  endpoint: string | null
  envNames: string[]
  liveEnvVar: typeof MCP_PROCESS_ENABLE_ENV
  commandAllowlistEnvVar: typeof MCP_COMMAND_ALLOWLIST_ENV
  commandAllowlisted: boolean
  endpointHostAllowlistEnvVar: typeof MCP_ENDPOINT_HOST_ALLOWLIST_ENV
  endpointHost: string | null
  endpointHostAllowlistConfigured: boolean
  endpointHostAllowlisted: boolean
  liveBlockedReasons: string[]
  warnings: string[]
}

export interface McpRuntimeResult {
  action: McpRuntimeAction
  status: McpRuntimeStatus
  liveRequested: boolean
  liveExecuted: boolean
  plan: McpRuntimePlan
  pid: number | null
  message: string
  checkedAt: number
}

interface RunningMcpProcess {
  child: ChildProcess
  pid: number
  startedAt: number
  command: string
  args: string[]
}

const runningProcesses = new Map<string, RunningMcpProcess>()

export async function planMcpServerRuntime(mcpServerId: string): Promise<McpRuntimeResult> {
  const server = await getRequiredMcpServer(mcpServerId)
  const plan = buildMcpRuntimePlan(server)
  return {
    action: 'plan',
    status: plan.status === 'ready' ? 'planned' : 'blocked',
    liveRequested: false,
    liveExecuted: false,
    plan,
    pid: runningPid(mcpServerId),
    message: plan.status === 'ready'
      ? 'MCP server runtime launch plan is structurally ready.'
      : plan.liveBlockedReasons[0] ?? 'MCP server runtime is blocked.',
    checkedAt: Date.now(),
  }
}

export async function getMcpServerRuntimeStatus(mcpServerId: string): Promise<McpRuntimeResult> {
  const server = await getRequiredMcpServer(mcpServerId)
  const plan = buildMcpRuntimePlan(server)
  const pid = runningPid(mcpServerId)
  const status: McpRuntimeStatus = pid ? 'running' : plan.status === 'ready' ? 'ready' : 'blocked'
  return {
    action: 'status',
    status,
    liveRequested: false,
    liveExecuted: false,
    plan,
    pid,
    message: pid
      ? `MCP server process is tracked as running with pid ${pid}.`
      : status === 'ready'
        ? 'MCP server is ready to start when live gates are enabled.'
        : plan.liveBlockedReasons[0] ?? 'MCP server runtime is blocked.',
    checkedAt: Date.now(),
  }
}

export async function startMcpServerRuntime(
  mcpServerId: string,
  options: McpRuntimeOptions = {},
): Promise<McpRuntimeResult> {
  const server = await getRequiredMcpServer(mcpServerId)
  const plan = buildMcpRuntimePlan(server)
  const checkedAt = Date.now()
  const liveRequested = Boolean(options.live)
  const existingPid = runningPid(mcpServerId)

  if (existingPid) {
    return {
      action: 'start',
      status: 'running',
      liveRequested,
      liveExecuted: false,
      plan,
      pid: existingPid,
      message: `MCP server process is already running with pid ${existingPid}.`,
      checkedAt,
    }
  }

  if (plan.status !== 'ready') {
    await updateMcpServerRuntimeHealth(server.id, 'failed', plan.liveBlockedReasons[0] ?? 'MCP runtime plan is blocked.')
    return {
      action: 'start',
      status: 'blocked',
      liveRequested,
      liveExecuted: false,
      plan,
      pid: null,
      message: plan.liveBlockedReasons[0] ?? 'MCP runtime plan is blocked.',
      checkedAt,
    }
  }

  if (!liveRequested) {
    await updateMcpServerRuntimeHealth(server.id, 'ok', 'MCP runtime start was planned only; no process was launched.')
    return {
      action: 'start',
      status: 'planned',
      liveRequested,
      liveExecuted: false,
      plan,
      pid: null,
      message: 'MCP runtime start was planned only; no process was launched.',
      checkedAt,
    }
  }

  const gateReason = liveStartGateReason(plan, options)
  if (gateReason) {
    await updateMcpServerRuntimeHealth(server.id, 'failed', gateReason)
    await auditMcpRuntime(server, 'start', 'blocked', gateReason, { plan: plan as unknown as JsonObject })
    return {
      action: 'start',
      status: 'blocked',
      liveRequested,
      liveExecuted: false,
      plan,
      pid: null,
      message: gateReason,
      checkedAt,
    }
  }

  if (server.transport !== 'stdio') {
    await updateMcpServerRuntimeHealth(
      server.id,
      'ok',
      'MCP endpoint transport is external; AgentHub verified the endpoint configuration but did not launch a local process.',
    )
    return {
      action: 'start',
      status: 'ready',
      liveRequested,
      liveExecuted: false,
      plan,
      pid: null,
      message: 'MCP endpoint transport is external; no local process launch is required.',
      checkedAt,
    }
  }

  try {
    const child = spawn(plan.command as string, plan.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ...server.env },
    })
    child.unref()
    const pid = child.pid ?? null
    if (!pid) throw new Error('MCP process did not report a pid.')
    runningProcesses.set(server.id, {
      child,
      pid,
      startedAt: checkedAt,
      command: plan.command as string,
      args: plan.args,
    })
    await updateMcpServerRuntimeHealth(server.id, 'ok', `MCP server process started with pid ${pid}.`)
    await auditMcpRuntime(server, 'start', 'allowed', `MCP server process started with pid ${pid}.`, {
      pid,
      plan: plan as unknown as JsonObject,
    })
    return {
      action: 'start',
      status: 'running',
      liveRequested,
      liveExecuted: true,
      plan,
      pid,
      message: `MCP server process started with pid ${pid}.`,
      checkedAt,
    }
  } catch (err) {
    const message = formatError(err)
    await updateMcpServerRuntimeHealth(server.id, 'failed', message)
    await auditMcpRuntime(server, 'start', 'warning', message, { plan: plan as unknown as JsonObject })
    return {
      action: 'start',
      status: 'failed',
      liveRequested,
      liveExecuted: false,
      plan,
      pid: null,
      message,
      checkedAt,
    }
  }
}

export async function stopMcpServerRuntime(
  mcpServerId: string,
  options: McpRuntimeOptions = {},
): Promise<McpRuntimeResult> {
  const server = await getRequiredMcpServer(mcpServerId)
  const plan = buildMcpRuntimePlan(server)
  const checkedAt = Date.now()
  const liveRequested = Boolean(options.live)
  const running = runningProcesses.get(server.id)

  if (!liveRequested) {
    return {
      action: 'stop',
      status: running ? 'planned' : 'stopped',
      liveRequested,
      liveExecuted: false,
      plan,
      pid: running?.pid ?? null,
      message: running
        ? 'MCP runtime stop was planned only; no process was stopped.'
        : 'No AgentHub-tracked MCP process is running.',
      checkedAt,
    }
  }

  if (process.env[MCP_PROCESS_ENABLE_ENV] !== '1') {
    const message = `${MCP_PROCESS_ENABLE_ENV}=1 is required before AgentHub can stop a live MCP process.`
    return {
      action: 'stop',
      status: 'blocked',
      liveRequested,
      liveExecuted: false,
      plan,
      pid: running?.pid ?? null,
      message,
      checkedAt,
    }
  }

  if (!running) {
    await updateMcpServerRuntimeHealth(server.id, 'unknown', 'No AgentHub-tracked MCP process is running.')
    return {
      action: 'stop',
      status: 'stopped',
      liveRequested,
      liveExecuted: false,
      plan,
      pid: null,
      message: 'No AgentHub-tracked MCP process is running.',
      checkedAt,
    }
  }

  try {
    running.child.kill()
    runningProcesses.delete(server.id)
    await updateMcpServerRuntimeHealth(server.id, 'unknown', `MCP server process ${running.pid} was stopped.`)
    await auditMcpRuntime(server, 'stop', 'allowed', `MCP server process ${running.pid} was stopped.`, {
      pid: running.pid,
    })
    return {
      action: 'stop',
      status: 'stopped',
      liveRequested,
      liveExecuted: true,
      plan,
      pid: running.pid,
      message: `MCP server process ${running.pid} was stopped.`,
      checkedAt,
    }
  } catch (err) {
    const message = formatError(err)
    await updateMcpServerRuntimeHealth(server.id, 'failed', message)
    await auditMcpRuntime(server, 'stop', 'warning', message, { pid: running.pid })
    return {
      action: 'stop',
      status: 'failed',
      liveRequested,
      liveExecuted: false,
      plan,
      pid: running.pid,
      message,
      checkedAt,
    }
  }
}

export function buildMcpRuntimePlan(server: McpServerRow): McpRuntimePlan {
  const blocked: string[] = []
  const warnings: string[] = []
  const command = server.command?.trim() || null
  const endpoint = server.endpoint?.trim() || null
  const args = Array.isArray(server.args) ? server.args.filter((arg) => typeof arg === 'string') : []
  const commandAllowlisted = command ? isCommandAllowlisted(command) : false
  const endpointGate = evaluateEndpointHostAllowlist(endpoint)

  if (!server.enabled) blocked.push('MCP server is disabled.')

  if (server.transport === 'stdio') {
    if (!command) blocked.push('stdio MCP server requires a command.')
    if (command && hasUnsafeCommandText(command)) {
      blocked.push('MCP command must be a direct executable path or binary name, not a shell expression.')
    }
    if (args.some(hasUnsafeArgumentText)) {
      blocked.push('MCP args must not contain line breaks or null bytes.')
    }
    if (command && !commandAllowlisted) {
      warnings.push(`${MCP_COMMAND_ALLOWLIST_ENV} must include ${command} or ${path.basename(command)} before live launch.`)
    }
  } else {
    if (!endpoint) blocked.push(`${server.transport} MCP server requires an endpoint.`)
    if (endpoint && !isHttpEndpoint(endpoint)) blocked.push('MCP endpoint must use http:// or https://.')
    if (endpoint && !endpointGate.configured) {
      warnings.push(`${MCP_ENDPOINT_HOST_ALLOWLIST_ENV} must include ${endpointGate.host ?? 'the MCP endpoint host'} before live remote MCP JSON-RPC execution.`)
    } else if (endpoint && !endpointGate.allowed) {
      warnings.push(`MCP endpoint host ${endpointGate.host ?? 'unknown'} is not listed in ${MCP_ENDPOINT_HOST_ALLOWLIST_ENV}.`)
    }
  }

  return {
    mcpServerId: server.id,
    displayName: server.displayName,
    transport: server.transport,
    status: blocked.length === 0 ? 'ready' : 'blocked',
    command,
    args,
    endpoint,
    envNames: Object.keys(server.env).sort(),
    liveEnvVar: MCP_PROCESS_ENABLE_ENV,
    commandAllowlistEnvVar: MCP_COMMAND_ALLOWLIST_ENV,
    commandAllowlisted,
    endpointHostAllowlistEnvVar: MCP_ENDPOINT_HOST_ALLOWLIST_ENV,
    endpointHost: endpointGate.host,
    endpointHostAllowlistConfigured: endpointGate.configured,
    endpointHostAllowlisted: endpointGate.allowed,
    liveBlockedReasons: blocked,
    warnings,
  }
}

function liveStartGateReason(plan: McpRuntimePlan, options: McpRuntimeOptions): string | null {
  if (!options.confirmRisk) return 'confirmRisk=true is required before live MCP process actions.'
  if (process.env[MCP_PROCESS_ENABLE_ENV] !== '1') {
    return `${MCP_PROCESS_ENABLE_ENV}=1 is required before live MCP process actions.`
  }
  if (plan.transport === 'stdio' && !plan.commandAllowlisted) {
    return `${MCP_COMMAND_ALLOWLIST_ENV} must include the MCP command or basename before live launch.`
  }
  return null
}

function isCommandAllowlisted(command: string): boolean {
  const allowed = parseAllowlist(process.env[MCP_COMMAND_ALLOWLIST_ENV])
  if (allowed.length === 0) return false
  const normalized = normalizeCommand(command)
  const basename = normalizeCommand(path.basename(command))
  return allowed.some((item) => {
    const normalizedItem = normalizeCommand(item)
    return normalizedItem === normalized || normalizedItem === basename
  })
}

function parseAllowlist(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function evaluateEndpointHostAllowlist(endpoint: string | null): {
  configured: boolean
  host: string | null
  allowed: boolean
} {
  const patterns = parseAllowlist(process.env[MCP_ENDPOINT_HOST_ALLOWLIST_ENV]).map((value) => value.toLowerCase())
  const host = endpointHost(endpoint)
  if (!host) return { configured: patterns.length > 0, host: null, allowed: false }
  return {
    configured: patterns.length > 0,
    host,
    allowed: patterns.some((pattern) => endpointHostMatches(host, pattern)),
  }
}

function endpointHost(endpoint: string | null): string | null {
  if (!endpoint) return null
  try {
    return new URL(endpoint).hostname.trim().toLowerCase() || null
  } catch {
    return null
  }
}

function endpointHostMatches(host: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern === host) return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return host === suffix || host.endsWith(`.${suffix}`)
  }
  return false
}

function normalizeCommand(value: string): string {
  return value.trim().replace(/^"|"$/g, '').toLowerCase()
}

function hasUnsafeCommandText(value: string): boolean {
  return /[\r\n\0]|(?:^|\s)(?:&&|\|\||[|<>;])(?:\s|$)/u.test(value)
}

function hasUnsafeArgumentText(value: string): boolean {
  return /[\r\n\0]/u.test(value)
}

function isHttpEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function runningPid(mcpServerId: string): number | null {
  const running = runningProcesses.get(mcpServerId)
  if (!running) return null
  if (isProcessLikelyRunning(running.pid)) return running.pid
  runningProcesses.delete(mcpServerId)
  return null
}

function isProcessLikelyRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function getRequiredMcpServer(id: string): Promise<McpServerRow> {
  const row = await db.query.mcpServers.findFirst({ where: eq(schema.mcpServers.id, id) })
  if (!row) throw new Error(`MCP server not found: ${id}`)
  return row
}

async function updateMcpServerRuntimeHealth(id: string, status: HealthStatus, message: string): Promise<void> {
  const now = Date.now()
  await db
    .update(schema.mcpServers)
    .set({
      healthStatus: status,
      lastTestResult: message,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.mcpServers.id, id))
}

async function auditMcpRuntime(
  server: McpServerRow,
  action: 'start' | 'stop',
  status: 'allowed' | 'blocked' | 'warning',
  message: string,
  metadata: JsonObject,
): Promise<void> {
  await recordAuditLog({
    actorType: 'system',
    action: `mcp.runtime.${action}`,
    resourceType: 'mcp_server',
    resourceId: server.id,
    status,
    riskLevel: 'medium',
    message,
    metadata,
  })
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
