import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { BehaviorDriftAnalysisBody } from '@/server/control-plane-validators'
import { analyzeBehaviorDrift } from '@/server/behavior-stabilization-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, BehaviorDriftAnalysisBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { result: await analyzeBehaviorDrift(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
