import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { CapabilityNegotiationResolutionBody } from '@/server/control-plane-validators'
import { resolveCapabilityNegotiation } from '@/server/capability-negotiation-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, CapabilityNegotiationResolutionBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      {
        snapshot: await resolveCapabilityNegotiation({
          negotiationId: await getRouteId(ctx),
          ...parsed.data,
        }),
      },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
