import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { EthicalAlignmentEvaluationBody } from '@/server/control-plane-validators'
import { evaluateEthicalAlignment } from '@/server/ethical-alignment-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, EthicalAlignmentEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { evaluation: await evaluateEthicalAlignment(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
