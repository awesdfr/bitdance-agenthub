import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AgentProtocolStatus } from '@/db/schema'
import { AgentCommunicationProtocolBody } from '@/server/control-plane-validators'
import {
  createAgentCommunicationProtocol,
  listAgentCommunicationProtocols,
} from '@/server/agent-communication-protocol-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    protocols: await listAgentCommunicationProtocols({
      version: req.nextUrl.searchParams.get('version') ?? undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | AgentProtocolStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 20),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentCommunicationProtocolBody)
  if (!parsed.ok) return parsed.response
  try {
    const protocol = await createAgentCommunicationProtocol(parsed.data)
    return NextResponse.json({ protocol }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
