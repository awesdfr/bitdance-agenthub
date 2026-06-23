import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { EntityStateTransitionEvaluationBody } from '@/server/control-plane-validators'
import { evaluateEntityStateTransition } from '@/server/entity-state-machine-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, EntityStateTransitionEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      evaluation: await evaluateEntityStateTransition(parsed.data),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
