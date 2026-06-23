import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { completeAgentRetirementPlan } from '@/server/agent-continuity-service'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const agentRetirementPlan = await completeAgentRetirementPlan(await getRouteId(ctx))
    return NextResponse.json({ agentRetirementPlan })
  } catch (err) {
    return errorResponse(err)
  }
}
