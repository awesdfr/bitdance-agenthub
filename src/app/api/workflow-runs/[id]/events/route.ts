import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getWorkflowRunSnapshot } from '@/server/control-plane-service'
import {
  eventFeedSseHeaders,
  eventFeedToSse,
  getWorkflowRunEventFeed,
} from '@/server/run-event-feed-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const runId = await getRouteId(ctx)
    const [snapshot, feed] = await Promise.all([
      getWorkflowRunSnapshot(runId),
      getWorkflowRunEventFeed(runId),
    ])
    if (wantsSse(req)) return new Response(eventFeedToSse(feed), { headers: eventFeedSseHeaders() })
    return NextResponse.json({ events: snapshot.nodeRuns, feed })
  } catch (err) {
    return errorResponse(err, 404)
  }
}

function wantsSse(req: NextRequest): boolean {
  return (
    req.nextUrl.searchParams.get('stream') === '1' ||
    req.headers.get('accept')?.includes('text/event-stream') === true
  )
}
