import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { LimitationAcknowledgementBody } from '@/server/control-plane-validators'
import { acknowledgeKnownLimitation } from '@/server/known-limitation-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, LimitationAcknowledgementBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      acknowledgement: await acknowledgeKnownLimitation({
        limitationId: await getRouteId(ctx),
        ...parsed.data,
      }),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
