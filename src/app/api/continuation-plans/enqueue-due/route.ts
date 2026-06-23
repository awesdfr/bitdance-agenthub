import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { EnqueueDueContinuationPlansBody } from '@/server/control-plane-validators'
import { enqueueDueContinuationPlans } from '@/server/scheduler-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, EnqueueDueContinuationPlansBody)
    if (!parsed.ok) return parsed.response
    const result = await enqueueDueContinuationPlans(parsed.data)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
