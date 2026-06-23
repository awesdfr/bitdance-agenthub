import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentReputationReviewBody } from '@/server/control-plane-validators'
import {
  createAgentReputationReview,
  listAgentReputationReviews,
} from '@/server/agent-reputation-service'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return NextResponse.json({
    agentReputationReviews: await listAgentReputationReviews(await getRouteId(ctx)),
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseJsonBody(req, AgentReputationReviewBody)
    if (!parsed.ok) return parsed.response
    const agentReputationReview = await createAgentReputationReview({
      agentProfileId: await getRouteId(ctx),
      ...parsed.data,
    })
    return NextResponse.json({ agentReputationReview }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
