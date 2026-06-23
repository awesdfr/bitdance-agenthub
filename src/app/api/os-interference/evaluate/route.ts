import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { OSInterferenceEvaluationBody } from '@/server/control-plane-validators'
import { evaluateOSInterference } from '@/server/os-interference-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, OSInterferenceEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ evaluation: await evaluateOSInterference(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
