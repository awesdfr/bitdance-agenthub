import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { OutputConsistencyEvaluationBody } from '@/server/control-plane-validators'
import { evaluateOutputConsistency } from '@/server/output-consistency-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, OutputConsistencyEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ result: await evaluateOutputConsistency(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
