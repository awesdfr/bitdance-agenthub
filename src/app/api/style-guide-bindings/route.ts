import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentStyleGuideBindingBody } from '@/server/control-plane-validators'
import {
  bindStyleGuideToAgent,
  listAgentStyleGuideBindings,
} from '@/server/style-guide-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return NextResponse.json({
    bindings: await listAgentStyleGuideBindings({
      agentProfileId: searchParams.get('agentProfileId'),
      styleGuideId: searchParams.get('styleGuideId'),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentStyleGuideBindingBody)
  if (!parsed.ok) return parsed.response
  try {
    const binding = await bindStyleGuideToAgent(parsed.data)
    return NextResponse.json({ binding }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
