import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RecoveryStrategyRecommendationBody } from '@/server/control-plane-validators'
import { recommendRecoveryStrategy } from '@/server/error-recovery-strategy-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, RecoveryStrategyRecommendationBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { recommendation: await recommendRecoveryStrategy(parsed.data) },
      { status: 200 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
