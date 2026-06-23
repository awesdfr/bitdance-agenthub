import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ContinuationPlanEnqueueBody } from '@/server/control-plane-validators'
import { enqueueTask } from '@/server/scheduler-service'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const parsed = await parseJsonBody(req, ContinuationPlanEnqueueBody)
    if (!parsed.ok) return parsed.response
    const continuationPlanId = await getRouteId(ctx)
    const taskQueueItem = await enqueueTask({
      queueId: parsed.data.queueId,
      kind: 'continuation_plan',
      priority: parsed.data.priority,
      scheduledAt: parsed.data.scheduledAt,
      payload: {
        continuationPlanId,
        input: parsed.data.input,
        budgetLimitCents: parsed.data.budgetLimitCents ?? null,
        autoComplete: parsed.data.autoComplete ?? true,
        ...(parsed.data.goal ? { goal: parsed.data.goal } : {}),
      },
    })
    return NextResponse.json({ taskQueueItem }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
