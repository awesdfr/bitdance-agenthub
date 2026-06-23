import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AgentProtocolMessageType } from '@/db/schema'
import { AgentProtocolMessageBody } from '@/server/control-plane-validators'
import {
  createAgentProtocolMessage,
  listAgentProtocolMessages,
} from '@/server/agent-communication-protocol-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    protocolMessages: await listAgentProtocolMessages({
      fromAgentId: req.nextUrl.searchParams.get('fromAgentId') ?? undefined,
      toAgentId: req.nextUrl.searchParams.get('toAgentId') ?? undefined,
      messageType: (req.nextUrl.searchParams.get('messageType') ?? undefined) as
        | AgentProtocolMessageType
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentProtocolMessageBody)
  if (!parsed.ok) return parsed.response
  try {
    const data = parsed.data
    const protocolMessage = await createAgentProtocolMessage({
      ...data,
      header: {
        ...data.header,
        to: data.header.to ?? null,
        replyTo: data.header.replyTo ?? null,
      },
      body: {
        ...data.body,
        proposedAction: data.body.proposedAction ?? null,
      },
      signature: data.signature ?? null,
    })
    return NextResponse.json({ protocolMessage }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
