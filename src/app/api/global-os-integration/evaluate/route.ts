import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { GlobalOSIntegrationEvaluationBody } from '@/server/control-plane-validators'
import { evaluateGlobalOSIntegration } from '@/server/global-os-integration-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, GlobalOSIntegrationEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ result: await evaluateGlobalOSIntegration(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
