import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { NfrEvaluationBody } from '@/server/control-plane-validators'
import { evaluateNfrRequirements } from '@/server/nfr-requirement-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, NfrEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await evaluateNfrRequirements(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
