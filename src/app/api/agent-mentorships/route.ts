import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentMentorshipBody } from '@/server/control-plane-validators'
import { createAgentMentorship, listAgentMentorships } from '@/server/agent-mentorship-service'

export async function GET(req: NextRequest) {
  try {
    const mentorAgentProfileId = req.nextUrl.searchParams.get('mentorAgentProfileId') ?? undefined
    const menteeAgentProfileId = req.nextUrl.searchParams.get('menteeAgentProfileId') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      mentorships: await listAgentMentorships({
        mentorAgentProfileId,
        menteeAgentProfileId,
        status:
          status === 'active' || status === 'paused' || status === 'graduated' || status === 'archived'
            ? status
            : undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, AgentMentorshipBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { mentorship: await createAgentMentorship(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
