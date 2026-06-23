import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { MetaAgentRecommendationStatusBody } from '@/server/control-plane-validators'
import { updateMetaAgentRecommendationStatus } from '@/server/meta-agent-service'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const parsed = await parseJsonBody(req, MetaAgentRecommendationStatusBody)
    if (!parsed.ok) return parsed.response
    const metaAgentRecommendation = await updateMetaAgentRecommendationStatus(
      await getRouteId(ctx),
      parsed.data.status,
    )
    return NextResponse.json({ metaAgentRecommendation })
  } catch (err) {
    return errorResponse(err)
  }
}
