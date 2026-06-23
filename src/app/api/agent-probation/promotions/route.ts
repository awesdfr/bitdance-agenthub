import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AgentEnvironmentPromotionStatus } from '@/db/schema'
import {
  listAgentEnvironmentPromotions,
  requestAgentProductionPromotion,
} from '@/server/agent-probation-service'
import { AgentPromotionRequestBody } from '@/server/control-plane-validators'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      promotions: await listAgentEnvironmentPromotions({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | AgentEnvironmentPromotionStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentPromotionRequestBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      promotion: await requestAgentProductionPromotion(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
