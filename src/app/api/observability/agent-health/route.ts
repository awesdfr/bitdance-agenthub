import { NextRequest, NextResponse } from 'next/server'

import { listAgentHealthScores } from '@/server/observability-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    agentHealthScores: await listAgentHealthScores(
      req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
    ),
  })
}
