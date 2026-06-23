import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TrustCalibrationEvaluationBody } from '@/server/control-plane-validators'
import { evaluateTrustCalibration } from '@/server/trust-calibration-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, TrustCalibrationEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ evaluation: await evaluateTrustCalibration(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
