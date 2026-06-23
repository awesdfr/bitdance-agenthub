import { NextRequest, NextResponse } from 'next/server'

import { listTaskQueueItems } from '@/server/scheduler-service'

export async function GET(req: NextRequest) {
  const queueId = req.nextUrl.searchParams.get('queueId') ?? undefined
  return NextResponse.json({ taskQueueItems: await listTaskQueueItems(queueId) })
}
