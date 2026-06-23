import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TelemetryEventEvaluationBody } from '@/server/control-plane-validators'
import { evaluateTelemetryEvent } from '@/server/telemetry-policy-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, TelemetryEventEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ result: await evaluateTelemetryEvent(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
