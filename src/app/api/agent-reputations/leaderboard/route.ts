import { NextRequest, NextResponse } from 'next/server'

import { getAgentReputationLeaderboard } from '@/server/agent-reputation-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') ?? 20)
  return NextResponse.json({
    agentReputationLeaderboard: await getAgentReputationLeaderboard({
      monthLabel: searchParams.get('monthLabel') ?? undefined,
      limit: Number.isFinite(limit) ? limit : 20,
    }),
  })
}
