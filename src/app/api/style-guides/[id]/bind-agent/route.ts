import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { StyleGuideBindAgentBody } from '@/server/control-plane-validators'
import { bindStyleGuideToAgent } from '@/server/style-guide-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, StyleGuideBindAgentBody)
  if (!parsed.ok) return parsed.response
  try {
    const styleGuideId = await getRouteId(ctx)
    const binding = await bindStyleGuideToAgent({
      styleGuideId,
      agentProfileId: parsed.data.agentProfileId,
      status: parsed.data.status,
    })
    return NextResponse.json({ binding }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
