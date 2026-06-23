import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { releaseRealtimeSegmentLock } from '@/server/collaboration-service'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const realtimeSegmentLock = await releaseRealtimeSegmentLock(await getRouteId(ctx))
    return NextResponse.json({ realtimeSegmentLock })
  } catch (err) {
    return errorResponse(err)
  }
}
