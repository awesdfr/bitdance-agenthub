import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentTeamDashboardCommandBody } from '@/server/control-plane-validators'
import { applyAgentTeamDashboardCommand } from '@/server/agent-team-dashboard-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, AgentTeamDashboardCommandBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      command: await applyAgentTeamDashboardCommand(await getRouteId(ctx), parsed.data.commandType),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
