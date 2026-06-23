import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { listEmployeeRunEvents } from '@/server/employee-runtime-service'
import { getSdkTask } from '@/server/programmatic-api-service'
import {
  eventFeedSseHeaders,
  eventFeedToSse,
  getEmployeeRunEventFeed,
} from '@/server/run-event-feed-service'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { sdkTask } = await getSdkTask(await getRouteId(ctx))
    if (!sdkTask.employeeRunId) throw new Error(`SDK task has no employee run: ${sdkTask.id}`)
    const [events, feed] = await Promise.all([
      listEmployeeRunEvents(sdkTask.employeeRunId),
      getEmployeeRunEventFeed(sdkTask.employeeRunId),
    ])
    if (wantsSse(req)) return new Response(eventFeedToSse(feed), { headers: eventFeedSseHeaders() })
    return NextResponse.json({ events, feed })
  } catch (err) {
    return errorResponse(err)
  }
}

function wantsSse(req: NextRequest): boolean {
  return (
    req.nextUrl.searchParams.get('stream') === '1' ||
    req.headers.get('accept')?.includes('text/event-stream') === true
  )
}
