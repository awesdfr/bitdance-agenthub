import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { EnqueueTaskBody } from '@/server/control-plane-validators'
import { enqueueTask } from '@/server/scheduler-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, EnqueueTaskBody)
  if (!parsed.ok) return parsed.response
  try {
    const taskQueueItem = await enqueueTask({
      queueId: await getRouteId(ctx),
      ...parsed.data,
    })
    return NextResponse.json({ taskQueueItem }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
