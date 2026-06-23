import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { discoverMcpTools } from '@/server/mcp-tool-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const mcpToolDefinitions = await discoverMcpTools(await getRouteId(ctx))
    return NextResponse.json({ mcpToolDefinitions }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
