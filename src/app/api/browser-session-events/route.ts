import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listBrowserSessionEvents } from '@/server/browser-session-service'

export async function GET(req: NextRequest) {
  try {
    const browserSessionId = req.nextUrl.searchParams.get('browserSessionId') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      events: await listBrowserSessionEvents({
        browserSessionId,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
