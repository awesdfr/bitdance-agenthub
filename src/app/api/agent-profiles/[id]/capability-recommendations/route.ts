import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { CapabilityRecommendationBody } from '@/server/control-plane-validators'
import {
  listCapabilityRecommendations,
  recommendCapabilitiesForAgent,
} from '@/server/capability-graph-service'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return NextResponse.json({
    capabilityRecommendations: await listCapabilityRecommendations(await getRouteId(ctx)),
  })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, CapabilityRecommendationBody)
  if (!parsed.ok) return parsed.response
  try {
    const capabilityRecommendationResults = await recommendCapabilitiesForAgent({
      agentProfileId: await getRouteId(ctx),
      goal: parsed.data.goal,
      limit: parsed.data.limit,
    })
    return NextResponse.json({ capabilityRecommendationResults }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
