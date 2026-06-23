import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentReputationRefreshBody } from '@/server/control-plane-validators'
import { computeAllAgentReputations, getAgentReputationLeaderboard } from '@/server/agent-reputation-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, AgentReputationRefreshBody)
    if (!parsed.ok) return parsed.response
    const snapshots = await computeAllAgentReputations(parsed.data)
    const leaderboard = await getAgentReputationLeaderboard({
      monthLabel: parsed.data.monthLabel,
      limit: parsed.data.limit,
    })
    return NextResponse.json({ agentReputationSnapshots: snapshots, agentReputationLeaderboard: leaderboard }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
