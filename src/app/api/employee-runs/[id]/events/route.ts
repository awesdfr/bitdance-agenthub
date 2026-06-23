import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { listEmployeeRunEvents } from '@/server/employee-runtime-service'
import {
  eventFeedSseHeaders,
  eventFeedToSse,
  getEmployeeRunEventFeed,
} from '@/server/run-event-feed-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const runId = await getRouteId(ctx)
    const [events, feed] = await Promise.all([
      listEmployeeRunEvents(runId),
      getEmployeeRunEventFeed(runId),
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
