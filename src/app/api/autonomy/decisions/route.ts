import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AutonomyDecisionBody } from '@/server/control-plane-validators'
import {
  evaluateAutonomyAction,
  listAutonomyDecisions,
} from '@/server/autonomy-policy-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    autonomyDecisions: await listAutonomyDecisions({
      agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
      resourceType: req.nextUrl.searchParams.get('resourceType') ?? undefined,
      resourceId: req.nextUrl.searchParams.get('resourceId') ?? undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AutonomyDecisionBody)
  if (!parsed.ok) return parsed.response
  try {
    const result = await evaluateAutonomyAction(parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
