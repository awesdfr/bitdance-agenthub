import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listFeatureFlagEvaluations } from '@/server/feature-flag-service'

export async function GET(req: NextRequest) {
  try {
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? 100)
    return NextResponse.json({
      featureFlagEvaluations: await listFeatureFlagEvaluations(Number.isFinite(limit) ? limit : 100),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
