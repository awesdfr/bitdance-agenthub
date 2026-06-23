import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentTeamDashboardBody } from '@/server/control-plane-validators'
import {
  createAgentTeamDashboardSnapshot,
  listAgentTeamDashboardSnapshots,
} from '@/server/agent-team-dashboard-service'

export async function GET(req: NextRequest) {
  try {
    const workflowRunId = req.nextUrl.searchParams.get('workflowRunId') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      snapshots: await listAgentTeamDashboardSnapshots({
        workflowRunId,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, AgentTeamDashboardBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { snapshot: await createAgentTeamDashboardSnapshot(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
