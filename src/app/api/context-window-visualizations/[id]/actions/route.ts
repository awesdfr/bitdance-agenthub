import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ContextWindowActionBody } from '@/server/control-plane-validators'
import { planContextWindowAction } from '@/server/context-window-visualizer-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, ContextWindowActionBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      actionPlan: await planContextWindowAction(await getRouteId(ctx), parsed.data.actionType),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
