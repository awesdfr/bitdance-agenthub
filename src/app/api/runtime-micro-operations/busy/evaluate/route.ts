import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RuntimeBusyEvaluationBody } from '@/server/control-plane-validators'
import { evaluateBusyTask } from '@/server/runtime-micro-operation-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, RuntimeBusyEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ decision: await evaluateBusyTask(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
