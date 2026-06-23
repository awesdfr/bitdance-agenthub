import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { TeamApprovalDecisionBody } from '@/server/control-plane-validators'
import {
  listTeamApprovalDecisions,
  recordTeamApprovalDecision,
} from '@/server/team-collaboration-service'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({
      teamApprovalDecisions: await listTeamApprovalDecisions({
        policyId: await getRouteId(ctx),
        userId: req.nextUrl.searchParams.get('userId') ?? undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseJsonBody(req, TeamApprovalDecisionBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      teamApprovalDecision: await recordTeamApprovalDecision({
        policyId: await getRouteId(ctx),
        ...parsed.data,
      }),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
