import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import { and, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  ApprovalRequestRow,
  HealthStatus,
  JsonObject,
  McpServerRow,
  McpToolCallMode,
  McpToolCallRow,
  McpToolDefinitionRow,
  RiskLevel,
} from '@/db/schema'
import { evaluateAutonomyAction } from '@/server/autonomy-policy-service'
import { newApprovalRequestId, newMcpToolCallId, newMcpToolDefinitionId } from '@/server/ids'
import {
  buildMcpRuntimePlan,
  MCP_COMMAND_ALLOWLIST_ENV,
  MCP_ENDPOINT_HOST_ALLOWLIST_ENV,
  MCP_PROCESS_ENABLE_ENV,
  type McpRuntimePlan,
} from '@/server/mcp-runtime-service'
import { recordAuditLog } from '@/server/security-service'

interface ToolManifestEntry {
  name: string
  displayName?: string
  description?: string
  inputSchema?: JsonObject
  outputSchema?: JsonObject
  annotations?: JsonObject
  riskLevel?: RiskLevel
  requiresApproval?: boolean
  enabled?: boolean
}

export interface RunMcpToolArgs {
  mcpToolDefinitionId: string
  agentProfileId?: string | null
  employeeRunId?: string | null
  workflowRunId?: string | null
  workflowNodeRunId?: string | null
  input?: JsonObject
  mode?: McpToolCallMode
  live?: boolean
  confirmRisk?: boolean
  approvalRequestId?: string | null
}

export async function discoverMcpTools(mcpServerId: string): Promise<McpToolDefinitionRow[]> {
  const server = await getRequiredMcpServer(mcpServerId)
  const entries = parseToolManifest(server)
  const rows: McpToolDefinitionRow[] = []
  for (const entry of entries) {
    rows.push(await upsertMcpToolDefinition(server, entry))
  }
  return rows
}

export async function listMcpToolDefinitions(
  mcpServerId?: string,
): Promise<McpToolDefinitionRow[]> {
  return db.query.mcpToolDefinitions.findMany({
    where: mcpServerId ? eq(schema.mcpToolDefinitions.mcpServerId, mcpServerId) : undefined,
    orderBy: [desc(schema.mcpToolDefinitions.updatedAt)],
    limit: 500,
  })
}

export async function runMcpTool(args: RunMcpToolArgs): Promise<McpToolCallRow> {
  const tool = await getRequiredMcpToolDefinition(args.mcpToolDefinitionId)
  const server = await getRequiredMcpServer(tool.mcpServerId)
  const agent = args.agentProfileId ? await getOptionalAgentProfile(args.agentProfileId) : null
  const mode = args.mode ?? 'dry_run'
  const input = args.input ?? {}
  const runtimePlan = buildMcpRuntimePlan(server)
  const structuralError = getMcpToolStructuralError(server, tool)
  const autonomy = await evaluateAutonomyAction({
    agentProfileId: agent?.id ?? args.agentProfileId ?? null,
    actionType: 'mcp_tool',
    resourceType: 'mcp_tool',
    resourceId: tool.id,
    requestedMode: mode,
    riskLevel: tool.riskLevel,
    payload: {
      mcpServerId: server.id,
      mcpServerName: server.displayName,
      toolName: tool.toolName,
      input,
    },
  })
  const policyError = autonomy.decision.status === 'blocked' ? autonomy.decision.reason : null
  let approvalRequest: ApprovalRequestRow | null = null
  let error = structuralError ?? policyError
  let status: McpToolCallRow['status'] = error ? 'blocked' : 'planned'
  let output: JsonObject | null = null
  const now = Date.now()

  if (!error && mode === 'execute') {
    const approval = await resolveMcpToolExecutionApproval({
      tool,
      server,
      agentProfileId: agent?.id ?? args.agentProfileId ?? null,
      employeeRunId: args.employeeRunId ?? null,
      workflowRunId: args.workflowRunId ?? null,
      workflowNodeRunId: args.workflowNodeRunId ?? null,
      input,
      autonomyDecisionId: autonomy.decision.id,
      riskLevel: autonomy.decision.riskLevel,
      approvalRequestId: args.approvalRequestId ?? null,
    })
    approvalRequest = approval.approvalRequest
    error = approval.error
  }

  if (!error && mode === 'execute') {
    error = getMcpToolLiveGateError({ server, runtimePlan, live: args.live, confirmRisk: args.confirmRisk })
  }

  if (!error && mode === 'execute') {
    try {
      const execution = await executeMcpJsonRpcTool({ server, tool, input, runtimePlan })
      status = 'complete'
      output = execution
      await updateMcpServerToolHealth(server.id, 'ok', `MCP tool ${tool.toolName} completed through JSON-RPC.`)
      await auditMcpJsonRpcToolCall({
        server,
        tool,
        status: 'allowed',
        message: `MCP tool ${tool.toolName} completed through JSON-RPC.`,
        input,
        output: execution,
        approvalRequest,
        runtimePlan,
      })
    } catch (err) {
      status = 'failed'
      error = formatError(err)
      await updateMcpServerToolHealth(server.id, 'failed', error)
      await auditMcpJsonRpcToolCall({
        server,
        tool,
        status: 'warning',
        message: error,
        input,
        output: null,
        approvalRequest,
        runtimePlan,
      })
    }
  } else if (!error) {
    output = {
      dryRun: true,
      mcpServerId: server.id,
      mcpServerName: server.displayName,
      transport: server.transport,
      toolName: tool.toolName,
      displayName: tool.displayName,
      riskLevel: tool.riskLevel,
      inputSchema: tool.inputSchema,
      runtimePlan: summarizeRuntimePlan(runtimePlan),
    }
  } else if (mode === 'execute' && args.live) {
    await auditMcpJsonRpcToolCall({
      server,
      tool,
      status: 'blocked',
      message: error,
      input,
      output: null,
      approvalRequest,
      runtimePlan,
    })
  }
  if (error && status === 'planned') status = 'blocked'

  const row = {
    id: newMcpToolCallId(),
    mcpToolDefinitionId: tool.id,
    mcpServerId: server.id,
    agentProfileId: agent?.id ?? args.agentProfileId ?? null,
    employeeRunId: args.employeeRunId ?? null,
    workflowRunId: args.workflowRunId ?? null,
    workflowNodeRunId: args.workflowNodeRunId ?? null,
    mode,
    status,
    input,
    output,
    error,
    requiresApproval: tool.requiresApproval || autonomy.decision.requiresApproval || mode === 'execute',
    autonomyDecisionId: autonomy.decision.id,
    approvalRequestId: approvalRequest?.id ?? args.approvalRequestId ?? null,
    createdAt: now,
    finishedAt: Date.now(),
  } satisfies McpToolCallRow

  await db.insert(schema.mcpToolCalls).values(row)
  return row
}

export async function listMcpToolCalls(args: {
  mcpServerId?: string
  employeeRunId?: string
  workflowRunId?: string
  agentProfileId?: string
} = {}): Promise<McpToolCallRow[]> {
  const filters = [
    args.mcpServerId ? eq(schema.mcpToolCalls.mcpServerId, args.mcpServerId) : undefined,
    args.employeeRunId ? eq(schema.mcpToolCalls.employeeRunId, args.employeeRunId) : undefined,
    args.workflowRunId ? eq(schema.mcpToolCalls.workflowRunId, args.workflowRunId) : undefined,
    args.agentProfileId ? eq(schema.mcpToolCalls.agentProfileId, args.agentProfileId) : undefined,
  ].filter(Boolean)
  return db.query.mcpToolCalls.findMany({
    where: filters.length > 0 ? and(...filters) : undefined,
    orderBy: [desc(schema.mcpToolCalls.createdAt)],
    limit: 200,
  })
}

async function upsertMcpToolDefinition(
  server: McpServerRow,
  entry: ToolManifestEntry,
): Promise<McpToolDefinitionRow> {
  const now = Date.now()
  const existing = await db.query.mcpToolDefinitions.findFirst({
    where: and(
      eq(schema.mcpToolDefinitions.mcpServerId, server.id),
      eq(schema.mcpToolDefinitions.toolName, entry.name),
    ),
  })
  if (existing) {
    await db
      .update(schema.mcpToolDefinitions)
      .set({
        displayName: entry.displayName ?? entry.name,
        description: entry.description ?? '',
        inputSchema: entry.inputSchema ?? {},
        outputSchema: entry.outputSchema ?? {},
        annotations: entry.annotations ?? {},
        riskLevel: entry.riskLevel ?? 'medium',
        requiresApproval: entry.requiresApproval ?? true,
        enabled: entry.enabled ?? true,
        updatedAt: now,
      })
      .where(eq(schema.mcpToolDefinitions.id, existing.id))
    const updated = await db.query.mcpToolDefinitions.findFirst({
      where: eq(schema.mcpToolDefinitions.id, existing.id),
    })
    if (!updated) throw new Error(`MCP tool missing after update: ${existing.id}`)
    return updated
  }

  const row: McpToolDefinitionRow = {
    id: newMcpToolDefinitionId(),
    mcpServerId: server.id,
    toolName: entry.name,
    displayName: entry.displayName ?? entry.name,
    description: entry.description ?? '',
    inputSchema: entry.inputSchema ?? {},
    outputSchema: entry.outputSchema ?? {},
    annotations: entry.annotations ?? {},
    riskLevel: entry.riskLevel ?? 'medium',
    requiresApproval: entry.requiresApproval ?? true,
    enabled: entry.enabled ?? true,
    discoveredAt: now,
    updatedAt: now,
  }
  await db.insert(schema.mcpToolDefinitions).values(row)
  return row
}

async function createMcpToolApprovalRequest(args: {
  tool: McpToolDefinitionRow
  server: McpServerRow
  agentProfileId: string | null
  employeeRunId: string | null
  workflowRunId: string | null
  workflowNodeRunId: string | null
  input: JsonObject
  autonomyDecisionId: string
  riskLevel: ApprovalRequestRow['riskLevel']
}): Promise<ApprovalRequestRow> {
  const now = Date.now()
  const row: ApprovalRequestRow = {
    id: newApprovalRequestId(),
    conversationId: null,
    runId: args.employeeRunId ?? args.workflowRunId,
    nodeRunId: args.workflowNodeRunId,
    agentProfileId: args.agentProfileId,
    type: 'mcp_tool_execute',
    status: 'pending',
    title: `Approve MCP tool: ${args.tool.displayName}`,
    description: 'An MCP tool requested live execution. Approval is recorded before any MCP process/tool call can run.',
    riskLevel: args.riskLevel,
    payload: {
      autonomyDecisionId: args.autonomyDecisionId,
      mcpServerId: args.server.id,
      mcpServerName: args.server.displayName,
      mcpToolDefinitionId: args.tool.id,
      toolName: args.tool.toolName,
      input: args.input,
    },
    response: null,
    createdAt: now,
    resolvedAt: null,
  }
  await db.insert(schema.approvalRequests).values(row)
  return row
}

async function resolveMcpToolExecutionApproval(args: {
  tool: McpToolDefinitionRow
  server: McpServerRow
  agentProfileId: string | null
  employeeRunId: string | null
  workflowRunId: string | null
  workflowNodeRunId: string | null
  input: JsonObject
  autonomyDecisionId: string
  riskLevel: ApprovalRequestRow['riskLevel']
  approvalRequestId: string | null
}): Promise<{ approvalRequest: ApprovalRequestRow | null; error: string | null }> {
  if (!args.approvalRequestId) {
    const approvalRequest = await createMcpToolApprovalRequest(args)
    return {
      approvalRequest,
      error:
        'MCP tool execution is waiting for approval; approve this request and retry with approvalRequestId, live=true, and confirmRisk=true.',
    }
  }

  const approvalRequest = await db.query.approvalRequests.findFirst({
    where: eq(schema.approvalRequests.id, args.approvalRequestId),
  })
  if (!approvalRequest) {
    return { approvalRequest: null, error: `Approval request not found: ${args.approvalRequestId}` }
  }
  if (approvalRequest.type !== 'mcp_tool_execute') {
    return { approvalRequest, error: `Approval request ${approvalRequest.id} is not for MCP tool execution.` }
  }
  if (approvalRequest.status !== 'approved') {
    return {
      approvalRequest,
      error: `Approval request ${approvalRequest.id} is ${approvalRequest.status}; approved status is required before MCP JSON-RPC execution.`,
    }
  }
  const payload = approvalRequest.payload
  if (payload.mcpToolDefinitionId !== args.tool.id) {
    return { approvalRequest, error: 'Approval request is bound to a different MCP tool definition.' }
  }
  if (payload.mcpServerId !== args.server.id) {
    return { approvalRequest, error: 'Approval request is bound to a different MCP server.' }
  }
  if (stableJson(payload.input ?? {}) !== stableJson(args.input)) {
    return { approvalRequest, error: 'Approval request input does not match the requested MCP tool input.' }
  }
  return { approvalRequest, error: null }
}

function getMcpToolLiveGateError(args: {
  server: McpServerRow
  runtimePlan: McpRuntimePlan
  live?: boolean
  confirmRisk?: boolean
}): string | null {
  if (!args.live) return 'live=true is required before MCP JSON-RPC tool execution.'
  if (!args.confirmRisk) return 'confirmRisk=true is required before MCP JSON-RPC tool execution.'
  if (args.runtimePlan.status !== 'ready') {
    return args.runtimePlan.liveBlockedReasons[0] ?? 'MCP runtime plan is blocked.'
  }
  if (process.env[MCP_PROCESS_ENABLE_ENV] !== '1') {
    return `${MCP_PROCESS_ENABLE_ENV}=1 is required before live MCP JSON-RPC tool execution.`
  }
  if (args.server.transport === 'stdio' && !args.runtimePlan.commandAllowlisted) {
    return `${MCP_COMMAND_ALLOWLIST_ENV} must include the MCP command or basename before live MCP JSON-RPC execution.`
  }
  if (args.server.transport !== 'stdio' && !args.runtimePlan.endpointHostAllowlistConfigured) {
    return `${MCP_ENDPOINT_HOST_ALLOWLIST_ENV} must include the MCP endpoint host before live remote MCP JSON-RPC execution.`
  }
  if (args.server.transport !== 'stdio' && !args.runtimePlan.endpointHostAllowlisted) {
    return `MCP endpoint host ${args.runtimePlan.endpointHost ?? 'unknown'} is not allowed by ${MCP_ENDPOINT_HOST_ALLOWLIST_ENV}.`
  }
  return null
}

async function executeMcpJsonRpcTool(args: {
  server: McpServerRow
  tool: McpToolDefinitionRow
  input: JsonObject
  runtimePlan: McpRuntimePlan
}): Promise<JsonObject> {
  if (args.server.transport === 'stdio') return executeMcpStdioTool(args)
  return executeMcpHttpTool(args)
}

async function executeMcpStdioTool(args: {
  server: McpServerRow
  tool: McpToolDefinitionRow
  input: JsonObject
  runtimePlan: McpRuntimePlan
}): Promise<JsonObject> {
  if (!args.runtimePlan.command) throw new Error('MCP stdio command is missing.')
  const startedAt = Date.now()
  const child = spawn(args.runtimePlan.command, args.runtimePlan.args, {
    stdio: 'pipe',
    windowsHide: true,
    env: { ...process.env, ...args.server.env },
  }) as ChildProcessWithoutNullStreams
  const client = createLineJsonRpcClient(child)
  try {
    const initialize = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'AgentHub', version: '0.1.0' },
    })
    client.notify('notifications/initialized', {})
    const listResult = await client.request('tools/list', {})
    const listedTools = extractMcpToolNames(listResult)
    if (!listedTools.includes(args.tool.toolName)) {
      throw new Error(`MCP server tools/list did not include ${args.tool.toolName}.`)
    }
    const callResult = await client.request('tools/call', {
      name: args.tool.toolName,
      arguments: args.input,
    })
    return {
      live: true,
      dryRun: false,
      protocol: 'mcp_jsonrpc_stdio',
      mcpServerId: args.server.id,
      mcpServerName: args.server.displayName,
      transport: args.server.transport,
      command: args.runtimePlan.command,
      args: args.runtimePlan.args,
      pid: child.pid ?? null,
      toolName: args.tool.toolName,
      listedTools,
      initialize: toJsonObject(initialize),
      result: toJsonObject(callResult),
      elapsedMs: Date.now() - startedAt,
    }
  } finally {
    client.close()
  }
}

async function executeMcpHttpTool(args: {
  server: McpServerRow
  tool: McpToolDefinitionRow
  input: JsonObject
  runtimePlan: McpRuntimePlan
}): Promise<JsonObject> {
  if (!args.runtimePlan.endpoint) throw new Error('MCP remote endpoint is missing.')
  const startedAt = Date.now()
  const client = createHttpJsonRpcClient(args.runtimePlan.endpoint, args.server.env)
  const initialize = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    clientInfo: { name: 'AgentHub', version: '0.1.0' },
  })
  await client.notify('notifications/initialized', {})
  const listResult = await client.request('tools/list', {})
  const listedTools = extractMcpToolNames(listResult)
  if (!listedTools.includes(args.tool.toolName)) {
    throw new Error(`Remote MCP server tools/list did not include ${args.tool.toolName}.`)
  }
  const callResult = await client.request('tools/call', {
    name: args.tool.toolName,
    arguments: args.input,
  })
  return {
    live: true,
    dryRun: false,
    protocol: 'mcp_jsonrpc_http',
    mcpServerId: args.server.id,
    mcpServerName: args.server.displayName,
    transport: args.server.transport,
    endpointHost: args.runtimePlan.endpointHost,
    endpointHostAllowlisted: args.runtimePlan.endpointHostAllowlisted,
    toolName: args.tool.toolName,
    listedTools,
    initialize: toJsonObject(initialize),
    result: toJsonObject(callResult),
    elapsedMs: Date.now() - startedAt,
  }
}

function createLineJsonRpcClient(child: ChildProcessWithoutNullStreams): {
  request: (method: string, params: JsonObject) => Promise<unknown>
  notify: (method: string, params: JsonObject) => void
  close: () => void
} {
  let nextId = 1
  let stdoutBuffer = ''
  let stderrPreview = ''
  const pending = new Map<
    string,
    {
      method: string
      timeout: ReturnType<typeof setTimeout>
      resolve: (value: unknown) => void
      reject: (error: Error) => void
    }
  >()

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8')
    while (stdoutBuffer.includes('\n')) {
      const index = stdoutBuffer.indexOf('\n')
      const line = stdoutBuffer.slice(0, index).trim()
      stdoutBuffer = stdoutBuffer.slice(index + 1)
      if (line) handleJsonRpcLine(line, pending)
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderrPreview = appendPreview(stderrPreview, chunk.toString('utf8'))
  })
  child.on('error', (error) => {
    rejectPending(pending, error)
  })
  child.on('exit', (code, signal) => {
    if (pending.size > 0) {
      rejectPending(
        pending,
        new Error(`MCP process exited before completing JSON-RPC requests: code=${code ?? 'null'} signal=${signal ?? 'null'} stderr=${stderrPreview}`),
      )
    }
  })

  return {
    request(method: string, params: JsonObject) {
      const id = String(nextId++)
      const message = { jsonrpc: '2.0', id: Number(id), method, params }
      return new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`MCP JSON-RPC request ${method} timed out. stderr=${stderrPreview}`))
        }, 8000)
        pending.set(id, { method, timeout, resolve, reject })
        child.stdin.write(`${JSON.stringify(message)}\n`, 'utf8')
      })
    },
    notify(method: string, params: JsonObject) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`, 'utf8')
    },
    close() {
      for (const entry of pending.values()) clearTimeout(entry.timeout)
      pending.clear()
      if (!child.killed) {
        child.stdin.end()
        child.kill()
      }
    },
  }
}

function createHttpJsonRpcClient(endpoint: string, env: Record<string, string>): {
  request: (method: string, params: JsonObject) => Promise<unknown>
  notify: (method: string, params: JsonObject) => Promise<void>
} {
  let nextId = 1
  return {
    async request(method: string, params: JsonObject) {
      const response = await postMcpJsonRpc(endpoint, {
        jsonrpc: '2.0',
        id: nextId++,
        method,
        params,
      }, env)
      if (response.error && typeof response.error === 'object') {
        const error = response.error as Record<string, unknown>
        throw new Error(`Remote MCP JSON-RPC ${method} failed: ${String(error.message ?? 'unknown error')}`)
      }
      return response.result
    },
    async notify(method: string, params: JsonObject) {
      await postMcpJsonRpc(endpoint, { jsonrpc: '2.0', method, params }, env)
    },
  }
}

async function postMcpJsonRpc(
  endpoint: string,
  body: JsonObject,
  env: Record<string, string>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: buildRemoteMcpHeaders(env),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Remote MCP endpoint returned HTTP ${res.status}: ${redactResponsePreview(text)}`)
    }
    if (!text.trim()) return {}
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Remote MCP endpoint returned a non-object JSON-RPC response.')
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Remote MCP JSON-RPC request timed out.')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

function buildRemoteMcpHeaders(env: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  }
  const authorization = env.AGENTHUB_MCP_AUTHORIZATION ?? env.MCP_AUTHORIZATION
  const bearerToken = env.AGENTHUB_MCP_BEARER_TOKEN ?? env.MCP_BEARER_TOKEN
  const apiKey = env.AGENTHUB_MCP_API_KEY ?? env.MCP_API_KEY
  const apiKeyHeader = env.AGENTHUB_MCP_API_KEY_HEADER ?? env.MCP_API_KEY_HEADER ?? 'x-api-key'
  if (authorization?.trim()) headers.authorization = authorization.trim()
  else if (bearerToken?.trim()) headers.authorization = `Bearer ${bearerToken.trim()}`
  if (apiKey?.trim()) headers[apiKeyHeader.trim()] = apiKey.trim()
  return headers
}

function handleJsonRpcLine(
  line: string,
  pending: Map<
    string,
    {
      method: string
      timeout: ReturnType<typeof setTimeout>
      resolve: (value: unknown) => void
      reject: (error: Error) => void
    }
  >,
): void {
  let message: unknown
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (!message || typeof message !== 'object') return
  const record = message as Record<string, unknown>
  const id = record.id === undefined ? null : String(record.id)
  if (!id) return
  const entry = pending.get(id)
  if (!entry) return
  pending.delete(id)
  clearTimeout(entry.timeout)
  if (record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>
    entry.reject(new Error(`MCP JSON-RPC ${entry.method} failed: ${String(error.message ?? 'unknown error')}`))
    return
  }
  entry.resolve(record.result)
}

function rejectPending(
  pending: Map<string, { timeout: ReturnType<typeof setTimeout>; reject: (error: Error) => void }>,
  error: Error,
): void {
  for (const [id, entry] of pending) {
    pending.delete(id)
    clearTimeout(entry.timeout)
    entry.reject(error)
  }
}

function extractMcpToolNames(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const tools = (result as Record<string, unknown>).tools
  if (!Array.isArray(tools)) return []
  return tools
    .map((tool) =>
      tool && typeof tool === 'object' && typeof (tool as Record<string, unknown>).name === 'string'
        ? String((tool as Record<string, unknown>).name)
        : null,
    )
    .filter((name): name is string => Boolean(name))
}

async function updateMcpServerToolHealth(id: string, status: HealthStatus, message: string): Promise<void> {
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

async function auditMcpJsonRpcToolCall(args: {
  server: McpServerRow
  tool: McpToolDefinitionRow
  status: 'allowed' | 'blocked' | 'warning'
  message: string
  input: JsonObject
  output: JsonObject | null
  approvalRequest: ApprovalRequestRow | null
  runtimePlan: McpRuntimePlan
}): Promise<void> {
  await recordAuditLog({
    actorType: 'system',
    action: 'mcp.tool.call.live',
    resourceType: 'mcp_tool',
    resourceId: args.tool.id,
    status: args.status,
    riskLevel: args.tool.riskLevel,
    message: args.message,
    metadata: {
      mcpServerId: args.server.id,
      mcpServerName: args.server.displayName,
      toolName: args.tool.toolName,
      transport: args.server.transport,
      command: args.runtimePlan.command,
      args: args.runtimePlan.args,
      endpointHost: args.runtimePlan.endpointHost,
      endpointHostAllowlisted: args.runtimePlan.endpointHostAllowlisted,
      endpointHostAllowlistConfigured: args.runtimePlan.endpointHostAllowlistConfigured,
      commandAllowlisted: args.runtimePlan.commandAllowlisted,
      approvalRequestId: args.approvalRequest?.id ?? null,
      inputHash: stableJson(args.input),
      outputKeys: args.output ? Object.keys(args.output).sort() : [],
      redacted: true,
    },
  })
}

function summarizeRuntimePlan(plan: McpRuntimePlan): JsonObject {
  return {
    status: plan.status,
    transport: plan.transport,
    command: plan.command,
    args: plan.args,
    endpoint: plan.endpoint,
    envNames: plan.envNames,
    liveEnvVar: plan.liveEnvVar,
    commandAllowlistEnvVar: plan.commandAllowlistEnvVar,
    commandAllowlisted: plan.commandAllowlisted,
    endpointHostAllowlistEnvVar: plan.endpointHostAllowlistEnvVar,
    endpointHost: plan.endpointHost,
    endpointHostAllowlistConfigured: plan.endpointHostAllowlistConfigured,
    endpointHostAllowlisted: plan.endpointHostAllowlisted,
    liveBlockedReasons: plan.liveBlockedReasons,
    warnings: plan.warnings,
  }
}

function parseToolManifest(server: McpServerRow): ToolManifestEntry[] {
  const raw = server.env.AGENTHUB_MCP_TOOLS ?? server.env.MCP_TOOLS
  const parsed = raw ? parseJson(raw) : null
  const parsedRecord =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  const candidates: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsedRecord && Array.isArray(parsedRecord.tools)
      ? parsedRecord.tools
      : []
  const tools = candidates
    .map(normalizeToolManifestEntry)
    .filter((entry): entry is ToolManifestEntry => Boolean(entry))
  if (tools.length > 0) return tools
  return [
    {
      name: 'server.describe',
      displayName: `${server.displayName} describe`,
      description: 'Describe MCP server metadata without invoking external tools.',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { serverId: { type: 'string' } } },
      annotations: { generated: true, transport: server.transport },
      riskLevel: 'low',
      requiresApproval: false,
      enabled: server.enabled,
    },
  ]
}

function normalizeToolManifestEntry(value: unknown): ToolManifestEntry | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const name = getString(record, 'name') ?? getString(record, 'toolName')
  if (!name) return null
  return {
    name,
    displayName: getString(record, 'displayName') ?? name,
    description: getString(record, 'description') ?? '',
    inputSchema: getJsonObject(record.inputSchema),
    outputSchema: getJsonObject(record.outputSchema),
    annotations: getJsonObject(record.annotations),
    riskLevel: getRiskLevel(record.riskLevel),
    requiresApproval:
      typeof record.requiresApproval === 'boolean' ? record.requiresApproval : undefined,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
  }
}

function getMcpToolStructuralError(server: McpServerRow, tool: McpToolDefinitionRow): string | null {
  if (!server.enabled) return 'MCP server is disabled.'
  if (!tool.enabled) return 'MCP tool is disabled.'
  if (!tool.toolName.trim()) return 'MCP tool name is required.'
  return null
}

async function getRequiredMcpServer(id: string): Promise<McpServerRow> {
  const row = await db.query.mcpServers.findFirst({ where: eq(schema.mcpServers.id, id) })
  if (!row) throw new Error(`MCP server not found: ${id}`)
  return row
}

async function getRequiredMcpToolDefinition(id: string): Promise<McpToolDefinitionRow> {
  const row = await db.query.mcpToolDefinitions.findFirst({
    where: eq(schema.mcpToolDefinitions.id, id),
  })
  if (!row) throw new Error(`MCP tool definition not found: ${id}`)
  return row
}

async function getOptionalAgentProfile(id: string): Promise<AgentProfileRow | null> {
  return (await db.query.agentProfiles.findFirst({ where: eq(schema.agentProfiles.id, id) })) ?? null
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function getRiskLevel(value: unknown): RiskLevel | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

function toJsonObject(value: unknown): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject
  return { value }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function appendPreview(current: string, next: string): string {
  return `${current}${next}`.slice(-2000)
}

function redactResponsePreview(text: string): string {
  return text
    .slice(0, 1000)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key["':=\s]+)[A-Za-z0-9._~+/-]{12,}/gi, '$1[redacted]')
    .replace(/(token["':=\s]+)[A-Za-z0-9._~+/-]{12,}/gi, '$1[redacted]')
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
