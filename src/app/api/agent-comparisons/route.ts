import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import {
  compareAgentProfiles,
  listAgentComparisonReports,
} from '@/server/agent-experiment-service'
import { AgentComparisonBody } from '@/server/control-plane-validators'

export async function GET(req: NextRequest) {
  try {
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    return NextResponse.json({
      comparisonReports: await listAgentComparisonReports({ agentProfileId }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentComparisonBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { comparisonReport: await compareAgentProfiles(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
