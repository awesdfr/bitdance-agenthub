import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { TakeoverCompleteBody } from '@/server/control-plane-validators'
import { completeTakeoverSession } from '@/server/human-collaboration-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, TakeoverCompleteBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      session: await completeTakeoverSession({
        takeoverSessionId: await getRouteId(ctx),
        ...parsed.data,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
