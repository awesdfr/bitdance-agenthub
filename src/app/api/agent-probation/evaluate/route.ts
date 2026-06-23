import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { evaluateAgentProbation } from '@/server/agent-probation-service'
import { AgentProbationEvaluateBody } from '@/server/control-plane-validators'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentProbationEvaluateBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      probationRecord: await evaluateAgentProbation(parsed.data),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
