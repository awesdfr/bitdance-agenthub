import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentScheduleEvaluationBody } from '@/server/control-plane-validators'
import { evaluateAgentAvailability } from '@/server/agent-schedule-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, AgentScheduleEvaluationBody)
    if (!parsed.ok) return parsed.response
    const result = await evaluateAgentAvailability({
      scheduleId: await getRouteId(ctx),
      ...parsed.data,
    })
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
