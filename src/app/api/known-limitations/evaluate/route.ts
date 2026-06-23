import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { KnownLimitationEvaluationBody } from '@/server/control-plane-validators'
import { evaluateKnownLimitations } from '@/server/known-limitation-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, KnownLimitationEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await evaluateKnownLimitations(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
