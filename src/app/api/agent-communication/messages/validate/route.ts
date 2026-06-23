import { NextRequest, NextResponse } from 'next/server'

import { parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentProtocolMessageBody } from '@/server/control-plane-validators'
import { validateAgentProtocolEnvelope } from '@/server/agent-communication-protocol-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentProtocolMessageBody)
  if (!parsed.ok) return parsed.response
  const data = parsed.data
  return NextResponse.json({
    validation: validateAgentProtocolEnvelope({
      version: data.version,
      messageId: data.messageId ?? 'preview-message',
      timestamp: data.timestamp ?? Date.now(),
      ttl: data.ttl,
      header: {
        from: data.header.from,
        to: data.header.to ?? null,
        type: data.header.type,
        priority: data.header.priority,
        replyTo: data.header.replyTo ?? null,
      },
      body: {
        intent: data.body.intent,
        detail: data.body.detail,
        context: data.body.context,
        proposedAction: data.body.proposedAction ?? null,
      },
      ...(data.signature ? { signature: data.signature } : {}),
    }),
  })
}
