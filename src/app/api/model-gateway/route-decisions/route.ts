import { NextRequest, NextResponse } from 'next/server'

import { listModelRouteDecisions } from '@/server/model-gateway-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    modelRouteDecisions: await listModelRouteDecisions(
      req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
    ),
  })
}
