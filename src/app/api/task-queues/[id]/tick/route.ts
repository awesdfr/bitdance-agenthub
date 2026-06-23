import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { TaskQueueTickBody } from '@/server/control-plane-validators'
import { runTaskQueueTick } from '@/server/scheduler-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, TaskQueueTickBody)
  if (!parsed.ok) return parsed.response
  try {
    const result = await runTaskQueueTick(await getRouteId(ctx), parsed.data)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
