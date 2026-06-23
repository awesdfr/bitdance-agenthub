import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RealtimeSegmentLockBody } from '@/server/control-plane-validators'
import {
  acquireRealtimeSegmentLock,
  listRealtimeSegmentLocks,
} from '@/server/collaboration-service'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? undefined
  return NextResponse.json({ realtimeSegmentLocks: await listRealtimeSegmentLocks(sessionId) })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, RealtimeSegmentLockBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(await acquireRealtimeSegmentLock(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
