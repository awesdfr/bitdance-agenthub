import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type {
  AgentDeploymentEnvironment,
  AgentProbationStatus,
} from '@/db/schema'
import { listAgentProbationRecords } from '@/server/agent-probation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      probationRecords: await listAgentProbationRecords({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | AgentProbationStatus
          | undefined,
        environment: (req.nextUrl.searchParams.get('environment') ?? undefined) as
          | AgentDeploymentEnvironment
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
