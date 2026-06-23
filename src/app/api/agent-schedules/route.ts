import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AgentScheduleStatus } from '@/db/schema'
import { AgentScheduleBody } from '@/server/control-plane-validators'
import { createAgentSchedule, listAgentSchedules } from '@/server/agent-schedule-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      agentSchedules: await listAgentSchedules({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | AgentScheduleStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, AgentScheduleBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ agentSchedule: await createAgentSchedule(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
