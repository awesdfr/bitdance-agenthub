import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentMessageBody } from '@/server/control-plane-validators'
import { listAgentMessages, sendAgentMessage } from '@/server/collaboration-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    messages: await listAgentMessages({
      channel: req.nextUrl.searchParams.get('channel') ?? undefined,
      recipientAgentProfileId: req.nextUrl.searchParams.get('recipientAgentProfileId') ?? undefined,
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentMessageBody)
  if (!parsed.ok) return parsed.response
  try {
    const message = await sendAgentMessage(parsed.data)
    return NextResponse.json({ message }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
