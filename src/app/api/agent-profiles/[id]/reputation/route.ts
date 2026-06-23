import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentReputationComputeBody } from '@/server/control-plane-validators'
import { computeAgentReputation } from '@/server/agent-reputation-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseJsonBody(req, AgentReputationComputeBody)
    if (!parsed.ok) return parsed.response
    const agentReputationSnapshot = await computeAgentReputation(await getRouteId(ctx), parsed.data)
    return NextResponse.json({ agentReputationSnapshot }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
