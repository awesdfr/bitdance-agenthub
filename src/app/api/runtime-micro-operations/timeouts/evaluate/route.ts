import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RuntimeTimeoutEvaluationBody } from '@/server/control-plane-validators'
import { evaluateRuntimeTimeout } from '@/server/runtime-micro-operation-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, RuntimeTimeoutEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ decision: await evaluateRuntimeTimeout(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
