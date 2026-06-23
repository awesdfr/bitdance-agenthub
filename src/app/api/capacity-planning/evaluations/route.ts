import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listCapacityPlanningEvaluations } from '@/server/capacity-planning-service'

export async function GET() {
  try {
    return NextResponse.json({ evaluations: await listCapacityPlanningEvaluations() })
  } catch (err) {
    return errorResponse(err)
  }
}
