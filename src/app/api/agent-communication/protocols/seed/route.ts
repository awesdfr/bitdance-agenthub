import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedAgentCommunicationProtocol } from '@/server/agent-communication-protocol-service'

export async function POST() {
  try {
    return NextResponse.json({ protocols: await seedAgentCommunicationProtocol() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
