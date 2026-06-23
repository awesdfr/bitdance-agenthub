import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { PerformanceAnalysisBody, PerformanceAnalysisScopeSchema } from '@/server/control-plane-validators'
import { listPerformanceAnalysisRuns, runPerformanceAnalysis } from '@/server/performance-analysis-service'

export async function GET(req: NextRequest) {
  try {
    const scope = req.nextUrl.searchParams.get('scope')
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    return NextResponse.json({
      runs: await listPerformanceAnalysisRuns({
        scope: scope ? PerformanceAnalysisScopeSchema.parse(scope) : undefined,
        agentProfileId,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, PerformanceAnalysisBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await runPerformanceAnalysis(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
