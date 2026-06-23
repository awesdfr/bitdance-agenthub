import { NextRequest } from 'next/server'

import { POST as runMcpTool } from '../src/app/api/mcp-tools/[id]/run/route'
import { createAgentProfile, createMcpServer, respondApprovalRequest } from '../src/server/control-plane-service'
import { discoverMcpTools } from '../src/server/mcp-tool-service'
import { MCP_COMMAND_ALLOWLIST_ENV, MCP_PROCESS_ENABLE_ENV } from '../src/server/mcp-runtime-service'
import { listAuditLogs } from '../src/server/security-service'

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return response.json() as Promise<T>
}

function postJson(path: string, body: unknown): NextRequest {
  return new NextRequest(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const manifest = [
    {
      name: 'smoke.echo',
      displayName: 'Smoke Echo',
      description: 'Echoes one message through a real MCP JSON-RPC tool call.',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      outputSchema: { type: 'object' },
      riskLevel: 'low',
      requiresApproval: false,
    },
  ]
  const mcp = await createMcpServer({
    displayName: 'Smoke JSON-RPC MCP',
    transport: 'stdio',
    command: 'node',
    args: ['scripts/fixtures/smoke-mcp-jsonrpc-server.mjs'],
    env: { AGENTHUB_MCP_TOOLS: JSON.stringify(manifest) },
  })
  const agent = await createAgentProfile({
    name: 'Smoke MCP JSON-RPC Agent',
    role: 'Verifies guarded live MCP JSON-RPC tool calls',
    mcpServerIds: [mcp.id],
    autonomyPolicy: { level: 'fully_autonomous' },
    permissionPolicy: { canUseMcp: true },
    outputContract: { artifactType: 'json' },
  })
  const tools = await discoverMcpTools(mcp.id)
  const echo = tools.find((tool) => tool.toolName === 'smoke.echo')
  assert(echo, 'Expected smoke.echo tool definition.')

  const input = { message: 'hello-mcp' }
  const blocked = await readJson<{
    mcpToolCall: {
      status: string
      mode: string
      error: string
      approvalRequestId: string | null
    }
  }>(
    await runMcpTool(
      postJson(`/api/mcp-tools/${echo.id}/run`, {
        agentProfileId: agent.id,
        input,
        mode: 'execute',
      }),
      { params: Promise.resolve({ id: echo.id }) },
    ),
  )
  assert(blocked.mcpToolCall.status === 'blocked', `Expected first execute to wait: ${blocked.mcpToolCall.status}`)
  assert(
    blocked.mcpToolCall.error.includes('waiting for approval') && blocked.mcpToolCall.approvalRequestId,
    `Expected approval request before live MCP JSON-RPC execution: ${JSON.stringify(blocked.mcpToolCall)}`,
  )

  await respondApprovalRequest(blocked.mcpToolCall.approvalRequestId, true, {
    reason: 'Smoke approves low-risk local MCP JSON-RPC echo.',
  })

  const previousGate = process.env[MCP_PROCESS_ENABLE_ENV]
  const previousAllowlist = process.env[MCP_COMMAND_ALLOWLIST_ENV]
  process.env[MCP_PROCESS_ENABLE_ENV] = '1'
  process.env[MCP_COMMAND_ALLOWLIST_ENV] = previousAllowlist ? `${previousAllowlist};node` : 'node'
  try {
    const live = await readJson<{
      mcpToolCall: {
        status: string
        mode: string
        error: string | null
        output: Record<string, unknown> | null
        approvalRequestId: string | null
      }
    }>(
      await runMcpTool(
        postJson(`/api/mcp-tools/${echo.id}/run`, {
          agentProfileId: agent.id,
          input,
          mode: 'execute',
          approvalRequestId: blocked.mcpToolCall.approvalRequestId,
          live: true,
          confirmRisk: true,
        }),
        { params: Promise.resolve({ id: echo.id }) },
      ),
    )
    assert(live.mcpToolCall.status === 'complete', `Expected live MCP JSON-RPC completion: ${JSON.stringify(live)}`)
    assert(live.mcpToolCall.error === null, `Expected no live MCP JSON-RPC error: ${live.mcpToolCall.error}`)
    assert(
      JSON.stringify(live.mcpToolCall.output).includes('echo:hello-mcp'),
      `Expected MCP JSON-RPC output to include echo result: ${JSON.stringify(live.mcpToolCall.output)}`,
    )
    assert(
      live.mcpToolCall.approvalRequestId === blocked.mcpToolCall.approvalRequestId,
      'Expected live call to stay bound to the approved request.',
    )

    const auditLogs = await listAuditLogs(20)
    assert(
      auditLogs.some(
        (log) =>
          log.action === 'mcp.tool.call.live' &&
          log.resourceId === echo.id &&
          log.status === 'allowed',
      ),
      'Expected an allowed MCP JSON-RPC audit log.',
    )

    console.log(
      JSON.stringify(
        {
          mcpServerId: mcp.id,
          mcpToolDefinitionId: echo.id,
          approvalRequestId: blocked.mcpToolCall.approvalRequestId,
          liveStatus: live.mcpToolCall.status,
        },
        null,
        2,
      ),
    )
  } finally {
    if (previousGate === undefined) delete process.env[MCP_PROCESS_ENABLE_ENV]
    else process.env[MCP_PROCESS_ENABLE_ENV] = previousGate
    if (previousAllowlist === undefined) delete process.env[MCP_COMMAND_ALLOWLIST_ENV]
    else process.env[MCP_COMMAND_ALLOWLIST_ENV] = previousAllowlist
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
