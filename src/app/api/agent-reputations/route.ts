import { NextRequest, NextResponse } from 'next/server'

import {
  listAgentReputationSnapshots,
} from '@/server/agent-reputation-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    agentReputationSnapshots: await listAgentReputationSnapshots({
      agentProfileId: searchParams.get('agentProfileId') ?? undefined,
      monthLabel: searchParams.get('monthLabel') ?? undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}
