import { NextRequest } from 'next/server'

import {
  GET as getMcpRuntime,
  POST as postMcpRuntime,
} from '../src/app/api/mcp-servers/[id]/runtime/route'
import { createMcpServer } from '../src/server/control-plane-service'
import { MCP_PROCESS_ENABLE_ENV } from '../src/server/mcp-runtime-service'

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return response.json() as Promise<T>
}

function postJson(body: unknown): NextRequest {
  return new NextRequest(
    new Request('http://localhost/api/mcp-servers/smoke/runtime', {
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
  const mcp = await createMcpServer({
    displayName: 'Smoke guarded MCP runtime',
    transport: 'stdio',
    command: 'node',
    args: ['smoke-mcp-server.js'],
    env: {
      AGENTHUB_MCP_TOOLS: JSON.stringify([
        {
          name: 'smoke.echo',
          displayName: 'Smoke echo',
          inputSchema: { type: 'object' },
          riskLevel: 'low',
          requiresApproval: false,
        },
      ]),
    },
  })
  const ctx = { params: Promise.resolve({ id: mcp.id }) }

  const planned = await readJson<{
    runtime: { status: string; liveExecuted: boolean; plan: { command: string; envNames: string[] } }
  }>(await postMcpRuntime(postJson({ action: 'plan' }), ctx))
  assert(planned.runtime.status === 'planned', `Expected planned runtime, got ${planned.runtime.status}`)
  assert(planned.runtime.liveExecuted === false, 'MCP plan must not live execute.')
  assert(planned.runtime.plan.command === 'node', `Expected node command: ${JSON.stringify(planned.runtime.plan)}`)
  assert(
    planned.runtime.plan.envNames.includes('AGENTHUB_MCP_TOOLS'),
    `Expected MCP env names to be redacted to names only: ${JSON.stringify(planned.runtime.plan.envNames)}`,
  )

  const dryStart = await readJson<{ runtime: { status: string; liveExecuted: boolean; pid: number | null } }>(
    await postMcpRuntime(postJson({ action: 'start', live: false }), ctx),
  )
  assert(dryStart.runtime.status === 'planned', `Expected dry start to be planned, got ${dryStart.runtime.status}`)
  assert(dryStart.runtime.liveExecuted === false && dryStart.runtime.pid === null, 'Dry start must not spawn a process.')

  const previousGate = process.env[MCP_PROCESS_ENABLE_ENV]
  delete process.env[MCP_PROCESS_ENABLE_ENV]
  try {
    const blockedStart = await readJson<{ runtime: { status: string; liveExecuted: boolean; message: string } }>(
      await postMcpRuntime(postJson({ action: 'start', live: true, confirmRisk: true }), ctx),
    )
    assert(blockedStart.runtime.status === 'blocked', `Expected live start to be blocked: ${blockedStart.runtime.status}`)
    assert(blockedStart.runtime.liveExecuted === false, 'Blocked live start must not execute.')
    assert(
      blockedStart.runtime.message.includes(MCP_PROCESS_ENABLE_ENV),
      `Expected MCP env gate in message: ${blockedStart.runtime.message}`,
    )
  } finally {
    if (previousGate === undefined) delete process.env[MCP_PROCESS_ENABLE_ENV]
    else process.env[MCP_PROCESS_ENABLE_ENV] = previousGate
  }

  const status = await readJson<{ runtime: { status: string; liveExecuted: boolean; pid: number | null } }>(
    await getMcpRuntime(new NextRequest('http://localhost/api/mcp-servers/smoke/runtime'), ctx),
  )
  assert(status.runtime.status === 'ready', `Expected status ready, got ${status.runtime.status}`)
  assert(status.runtime.liveExecuted === false && status.runtime.pid === null, 'Status must remain non-live in smoke.')

  console.log(
    JSON.stringify(
      {
        mcpServerId: mcp.id,
        planStatus: planned.runtime.status,
        dryStartStatus: dryStart.runtime.status,
        status: status.runtime.status,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
