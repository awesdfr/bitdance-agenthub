import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AgentVotingDecision } from '@/db/schema'
import { AgentConsensusVoteBody } from '@/server/control-plane-validators'
import {
  createAgentConsensusVote,
  listAgentConsensusVotes,
} from '@/server/consensus-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      votes: await listAgentConsensusVotes({
        decision: (req.nextUrl.searchParams.get('decision') ?? undefined) as
          | AgentVotingDecision
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AgentConsensusVoteBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ vote: await createAgentConsensusVote(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
