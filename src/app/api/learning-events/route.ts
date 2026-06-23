import { NextRequest, NextResponse } from 'next/server'

import { listLearningEvents } from '@/server/learning-service'

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status')
  return NextResponse.json({
    learningEvents: await listLearningEvents(
      status === 'pending_review' || status === 'approved' || status === 'rejected'
        ? status
        : undefined,
    ),
  })
}
