import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ProcessTaskQueueBody } from '@/server/control-plane-validators'
import { processTaskQueue } from '@/server/scheduler-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, ProcessTaskQueueBody)
  if (!parsed.ok) return parsed.response
  try {
    const result = await processTaskQueue(await getRouteId(ctx), parsed.data.maxItems)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
