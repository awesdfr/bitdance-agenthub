import { NextRequest, NextResponse } from 'next/server'

import { listAlertEvents } from '@/server/observability-service'

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status')
  return NextResponse.json({
    alertEvents: await listAlertEvents(
      status === 'open' || status === 'acknowledged' || status === 'resolved'
        ? status
        : undefined,
    ),
  })
}
