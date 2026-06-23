import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentDiversityProfileBody } from '@/server/control-plane-validators'
import {
  listAgentDiversityProfiles,
  upsertAgentDiversityProfile,
} from '@/server/agent-diversity-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return NextResponse.json({
    agentDiversityProfiles: await listAgentDiversityProfiles({
      agentProfileId: searchParams.get('agentProfileId'),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentDiversityProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    const agentDiversityProfile = await upsertAgentDiversityProfile(parsed.data)
    return NextResponse.json({ agentDiversityProfile }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
