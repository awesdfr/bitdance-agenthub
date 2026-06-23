import { createServer } from 'node:http'

import { NextRequest } from 'next/server'

import { POST as runMcpTool } from '../src/app/api/mcp-tools/[id]/run/route'
import { createAgentProfile, createMcpServer, respondApprovalRequest } from '../src/server/control-plane-service'
import { discoverMcpTools } from '../src/server/mcp-tool-service'
import {
  MCP_ENDPOINT_HOST_ALLOWLIST_ENV,
  MCP_PROCESS_ENABLE_ENV,
} from '../src/server/mcp-runtime-service'

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

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function main() {
  let requestCount = 0
  let sawBearer = false
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/mcp') {
        res.writeHead(404).end()
        return
      }
      requestCount += 1
      sawBearer = sawBearer || req.headers.authorization === 'Bearer remote-smoke-token'
      if (req.headers.authorization !== 'Bearer remote-smoke-token') {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { code: -32001, message: 'missing bearer' } }))
        return
      }
      const body = await readBody(req)
      if (!('id' in body)) {
        res.writeHead(202).end()
        return
      }
      if (body.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'remote-http-smoke-mcp', version: '0.1.0' },
          },
        }))
        return
      }
      if (body.method === 'tools/list') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'remote.echo',
                description: 'Remote HTTP MCP echo smoke tool.',
                inputSchema: {
                  type: 'object',
                  properties: { message: { type: 'string' } },
                  required: ['message'],
                },
              },
            ],
          },
        }))
        return
      }
      if (body.method === 'tools/call') {
        const params = body.params as { arguments?: { message?: string } } | undefined
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'text', text: `remote:${params?.arguments?.message ?? ''}` }],
            structuredContent: { remote: true, echoed: params?.arguments ?? {} },
            isError: false,
          },
        }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: `Unknown method: ${String(body.method)}` },
      }))
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object', 'Expected local HTTP MCP smoke server address.')
  const endpoint = `http://127.0.0.1:${address.port}/mcp`

  try {
    const manifest = [
      {
        name: 'remote.echo',
        displayName: 'Remote Echo',
        description: 'Echoes one message through a remote HTTP MCP JSON-RPC tool call.',
        inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
        outputSchema: { type: 'object' },
        riskLevel: 'low',
        requiresApproval: false,
      },
    ]
    const mcp = await createMcpServer({
      displayName: 'Smoke Remote HTTP MCP',
      transport: 'http',
      endpoint,
      env: {
        AGENTHUB_MCP_TOOLS: JSON.stringify(manifest),
        AGENTHUB_MCP_BEARER_TOKEN: 'remote-smoke-token',
      },
    })
    const agent = await createAgentProfile({
      name: 'Smoke remote MCP Agent',
      role: 'Verifies guarded remote HTTP MCP JSON-RPC tool calls',
      mcpServerIds: [mcp.id],
      autonomyPolicy: { level: 'fully_autonomous' },
      permissionPolicy: { canUseMcp: true },
      outputContract: { artifactType: 'json' },
    })
    const tools = await discoverMcpTools(mcp.id)
    const echo = tools.find((tool) => tool.toolName === 'remote.echo')
    assert(echo, 'Expected remote.echo tool definition.')

    const input = { message: 'hello-remote-mcp' }
    const blocked = await readJson<{
      mcpToolCall: { status: string; error: string; approvalRequestId: string | null }
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
    assert(blocked.mcpToolCall.status === 'blocked', 'Expected remote MCP execute to wait for approval first.')
    assert(blocked.mcpToolCall.approvalRequestId, 'Expected remote MCP execute to create approval request.')
    await respondApprovalRequest(blocked.mcpToolCall.approvalRequestId, true, {
      reason: 'Smoke approves low-risk remote HTTP MCP echo.',
    })

    const previousGate = process.env[MCP_PROCESS_ENABLE_ENV]
    const previousEndpointAllowlist = process.env[MCP_ENDPOINT_HOST_ALLOWLIST_ENV]
    process.env[MCP_PROCESS_ENABLE_ENV] = '1'
    process.env[MCP_ENDPOINT_HOST_ALLOWLIST_ENV] = previousEndpointAllowlist
      ? `${previousEndpointAllowlist};127.0.0.1`
      : '127.0.0.1'
    try {
      const live = await readJson<{
        mcpToolCall: {
          status: string
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
      assert(live.mcpToolCall.status === 'complete', `Expected remote MCP JSON-RPC completion: ${JSON.stringify(live)}`)
      assert(live.mcpToolCall.error === null, `Expected no remote MCP JSON-RPC error: ${live.mcpToolCall.error}`)
      assert(
        JSON.stringify(live.mcpToolCall.output).includes('remote:hello-remote-mcp'),
        `Expected remote MCP output: ${JSON.stringify(live.mcpToolCall.output)}`,
      )
      assert(sawBearer, 'Expected remote MCP call to send bearer token from server env.')
      assert(requestCount >= 3, `Expected initialize/list/call requests, saw ${requestCount}.`)
      console.log(
        JSON.stringify(
          {
            mcpServerId: mcp.id,
            mcpToolDefinitionId: echo.id,
            approvalRequestId: blocked.mcpToolCall.approvalRequestId,
            liveStatus: live.mcpToolCall.status,
            requestCount,
          },
          null,
          2,
        ),
      )
    } finally {
      if (previousGate === undefined) delete process.env[MCP_PROCESS_ENABLE_ENV]
      else process.env[MCP_PROCESS_ENABLE_ENV] = previousGate
      if (previousEndpointAllowlist === undefined) delete process.env[MCP_ENDPOINT_HOST_ALLOWLIST_ENV]
      else process.env[MCP_ENDPOINT_HOST_ALLOWLIST_ENV] = previousEndpointAllowlist
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
