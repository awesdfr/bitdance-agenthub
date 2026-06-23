import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { analyzeAgentWhatIf, listAgentWhatIfAnalyses } from '@/server/agent-experiment-service'
import { AgentWhatIfBody } from '@/server/control-plane-validators'

export async function GET(req: NextRequest) {
  try {
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    return NextResponse.json({
      whatIfAnalyses: await listAgentWhatIfAnalyses({ agentProfileId }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentWhatIfBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { whatIfAnalysis: await analyzeAgentWhatIf(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
