import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { applyCapabilityRecommendation } from '@/server/capability-graph-service'

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(await applyCapabilityRecommendation(await getRouteId(ctx)))
  } catch (err) {
    return errorResponse(err)
  }
}
