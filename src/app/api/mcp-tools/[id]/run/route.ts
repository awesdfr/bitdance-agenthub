import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { McpToolRunBody } from '@/server/control-plane-validators'
import { runMcpTool } from '@/server/mcp-tool-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, McpToolRunBody)
  if (!parsed.ok) return parsed.response
  try {
    const mcpToolCall = await runMcpTool({
      mcpToolDefinitionId: await getRouteId(ctx),
      ...parsed.data,
    })
    return NextResponse.json({ mcpToolCall }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
