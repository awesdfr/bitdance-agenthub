import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { applyAgentProductionPromotion } from '@/server/agent-probation-service'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json({
      promotion: await applyAgentProductionPromotion(await getRouteId(ctx)),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
