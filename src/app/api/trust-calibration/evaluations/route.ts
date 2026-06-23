import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { TrustCalibrationRecommendation } from '@/db/schema'
import { listTrustCalibrationEvaluations } from '@/server/trust-calibration-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listTrustCalibrationEvaluations({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        recommendation: (req.nextUrl.searchParams.get('recommendation') ?? undefined) as
          | TrustCalibrationRecommendation
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
