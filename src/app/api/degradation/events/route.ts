import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listDegradationEvents } from '@/server/degradation-service'

export async function GET(req: NextRequest) {
  try {
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? 100)
    return NextResponse.json({
      degradationEvents: await listDegradationEvents(Number.isFinite(limit) ? limit : 100),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
