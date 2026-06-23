import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ContinuationPlanStatusBody } from '@/server/control-plane-validators'
import { updateContinuationPlanStatus } from '@/server/agent-continuity-service'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const parsed = await parseJsonBody(req, ContinuationPlanStatusBody)
    if (!parsed.ok) return parsed.response
    const continuationPlan = await updateContinuationPlanStatus(
      await getRouteId(ctx),
      parsed.data.status,
    )
    return NextResponse.json({ continuationPlan })
  } catch (err) {
    return errorResponse(err)
  }
}
