import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { cloneAgentProfile, listAgentCloneRecords } from '@/server/agent-experiment-service'
import { AgentCloneBody } from '@/server/control-plane-validators'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const sourceAgentProfileId = await getRouteId(ctx)
    return NextResponse.json({
      cloneRecords: await listAgentCloneRecords({ sourceAgentProfileId }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, AgentCloneBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { result: await cloneAgentProfile(await getRouteId(ctx), parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
