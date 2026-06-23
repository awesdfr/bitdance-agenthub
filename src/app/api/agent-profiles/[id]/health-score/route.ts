import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { computeAgentHealthScore } from '@/server/observability-service'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const agentHealthScore = await computeAgentHealthScore(await getRouteId(ctx))
    return NextResponse.json({ agentHealthScore }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
