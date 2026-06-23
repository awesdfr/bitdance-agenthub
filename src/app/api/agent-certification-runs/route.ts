import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listAgentCertificationRuns } from '@/server/agent-certification-service'

export async function GET(req: NextRequest) {
  try {
    const passedParam = req.nextUrl.searchParams.get('passed')
    return NextResponse.json({
      certificationRuns: await listAgentCertificationRuns({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        examId: req.nextUrl.searchParams.get('examId') ?? undefined,
        passed: passedParam === null ? undefined : passedParam === 'true',
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
