import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listAgentMentoringEvents } from '@/server/agent-mentorship-service'

export async function GET(req: NextRequest) {
  try {
    const mentorshipId = req.nextUrl.searchParams.get('mentorshipId') ?? undefined
    const eventType = req.nextUrl.searchParams.get('eventType') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      events: await listAgentMentoringEvents({
        mentorshipId,
        eventType:
          eventType === 'review_output' ||
          eventType === 'intervene_when_stuck' ||
          eventType === 'share_memory' ||
          eventType === 'generate_practice_task' ||
          eventType === 'progress_update'
            ? eventType
            : undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
