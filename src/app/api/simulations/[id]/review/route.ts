import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { SimulationReviewBody } from '@/server/control-plane-validators'
import { reviewSimulationRun } from '@/server/simulation-backtest-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseJsonBody(req, SimulationReviewBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      simulationRun: await reviewSimulationRun(await getRouteId(ctx), parsed.data),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
