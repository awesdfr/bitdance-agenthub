import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { createAgentProfile, listAgentProfiles } from '@/server/control-plane-service'
import { AgentProfileBody } from '@/server/control-plane-validators'

export async function GET() {
  return NextResponse.json({ agentProfiles: await listAgentProfiles() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    const agentProfile = await createAgentProfile(parsed.data)
    return NextResponse.json({ agentProfile }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
