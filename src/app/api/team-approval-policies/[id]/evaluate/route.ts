import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { evaluateTeamApprovalPolicy } from '@/server/team-collaboration-service'

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({ resolution: await evaluateTeamApprovalPolicy(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  return GET(_, ctx)
}
