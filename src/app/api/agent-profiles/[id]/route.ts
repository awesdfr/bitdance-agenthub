import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { updateAgentProfile } from '@/server/control-plane-service'
import { AgentProfilePatchBody } from '@/server/control-plane-validators'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, AgentProfilePatchBody)
  if (!parsed.ok) return parsed.response
  try {
    const agentProfile = await updateAgentProfile(await getRouteId(ctx), parsed.data)
    return NextResponse.json({ agentProfile })
  } catch (err) {
    return errorResponse(err)
  }
}
