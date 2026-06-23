import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { McpServerRuntimeBody } from '@/server/control-plane-validators'
import {
  getMcpServerRuntimeStatus,
  planMcpServerRuntime,
  startMcpServerRuntime,
  stopMcpServerRuntime,
} from '@/server/mcp-runtime-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    return NextResponse.json({ runtime: await getMcpServerRuntimeStatus(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, McpServerRuntimeBody)
  if (!parsed.ok) return parsed.response
  try {
    const id = await getRouteId(ctx)
    const action = parsed.data.action
    const options = {
      live: parsed.data.live,
      confirmRisk: parsed.data.confirmRisk,
    }
    const runtime =
      action === 'plan'
        ? await planMcpServerRuntime(id)
        : action === 'start'
          ? await startMcpServerRuntime(id, options)
          : action === 'stop'
            ? await stopMcpServerRuntime(id, options)
            : await getMcpServerRuntimeStatus(id)
    return NextResponse.json({ runtime })
  } catch (err) {
    return errorResponse(err)
  }
}
