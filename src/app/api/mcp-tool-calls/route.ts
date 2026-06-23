import { NextRequest, NextResponse } from 'next/server'

import { listMcpToolCalls } from '@/server/mcp-tool-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    mcpToolCalls: await listMcpToolCalls({
      mcpServerId: req.nextUrl.searchParams.get('mcpServerId') ?? undefined,
      employeeRunId: req.nextUrl.searchParams.get('employeeRunId') ?? undefined,
      workflowRunId: req.nextUrl.searchParams.get('workflowRunId') ?? undefined,
      agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
    }),
  })
}
