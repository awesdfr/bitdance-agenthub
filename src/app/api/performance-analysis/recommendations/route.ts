import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listPerformanceOptimizationRecommendations } from '@/server/performance-analysis-service'

export async function GET(req: NextRequest) {
  try {
    const analysisRunId = req.nextUrl.searchParams.get('analysisRunId') ?? undefined
    return NextResponse.json({
      recommendations: await listPerformanceOptimizationRecommendations({ analysisRunId }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
