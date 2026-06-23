import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ResourceGovernorEvaluationBody } from '@/server/control-plane-validators'
import { evaluateResourceGovernor } from '@/server/resource-governor-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ResourceGovernorEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ result: await evaluateResourceGovernor(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
