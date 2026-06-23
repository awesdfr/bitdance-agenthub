import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { DegradationEvaluationBody } from '@/server/control-plane-validators'
import { evaluateDegradation } from '@/server/degradation-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, DegradationEvaluationBody)
    if (!parsed.ok) return parsed.response
    const degradationEvent = await evaluateDegradation(parsed.data)
    return NextResponse.json({ degradationEvent }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
