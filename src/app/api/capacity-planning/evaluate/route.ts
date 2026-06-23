import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { CapacityPlanningEvaluateBody } from '@/server/control-plane-validators'
import { evaluateCapacityPlan } from '@/server/capacity-planning-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, CapacityPlanningEvaluateBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ evaluation: await evaluateCapacityPlan(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
