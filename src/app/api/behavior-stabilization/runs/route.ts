import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { BehaviorStabilizationRunStatus } from '@/db/schema'
import { listBehaviorStabilizationRuns } from '@/server/behavior-stabilization-service'

export async function GET(req: NextRequest) {
  try {
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const driftAnalysisId = req.nextUrl.searchParams.get('driftAnalysisId') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      runs: await listBehaviorStabilizationRuns({
        agentProfileId,
        driftAnalysisId,
        status: status as BehaviorStabilizationRunStatus | undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
