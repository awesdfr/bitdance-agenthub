import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { TakeoverActionBody } from '@/server/control-plane-validators'
import { recordTakeoverAction } from '@/server/human-collaboration-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, TakeoverActionBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      session: await recordTakeoverAction(await getRouteId(ctx), parsed.data),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
