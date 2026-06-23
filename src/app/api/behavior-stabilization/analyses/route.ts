import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { BehaviorDriftSeverity } from '@/db/schema'
import { listBehaviorDriftAnalyses } from '@/server/behavior-stabilization-service'

export async function GET(req: NextRequest) {
  try {
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const severity = req.nextUrl.searchParams.get('severity') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      analyses: await listBehaviorDriftAnalyses({
        agentProfileId,
        severity: severity as BehaviorDriftSeverity | undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
