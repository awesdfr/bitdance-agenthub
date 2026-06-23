import { NextRequest, NextResponse } from 'next/server'

import { listMcpToolDefinitions } from '@/server/mcp-tool-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    mcpToolDefinitions: await listMcpToolDefinitions(
      req.nextUrl.searchParams.get('mcpServerId') ?? undefined,
    ),
  })
}
