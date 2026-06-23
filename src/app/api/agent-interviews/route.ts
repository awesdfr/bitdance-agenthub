import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentInterviewBody } from '@/server/control-plane-validators'
import {
  listAgentInterviews,
  runAgentInterview,
} from '@/server/agent-interview-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return NextResponse.json({
    agentInterviews: await listAgentInterviews({
      agentProfileId: searchParams.get('agentProfileId'),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentInterviewBody)
  if (!parsed.ok) return parsed.response
  try {
    const agentInterview = await runAgentInterview(parsed.data)
    return NextResponse.json({ agentInterview }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
