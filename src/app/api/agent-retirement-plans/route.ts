import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AgentRetirementStatus } from '@/db/schema'
import {
  createAgentRetirementPlan,
  listAgentRetirementPlans,
} from '@/server/agent-continuity-service'
import { AgentRetirementPlanBody } from '@/server/control-plane-validators'

const statuses = new Set(['draft', 'ready_for_review', 'completed', 'canceled'])

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    agentRetirementPlans: await listAgentRetirementPlans({
      agentProfileId: searchParams.get('agentProfileId') ?? undefined,
      targetAgentProfileId: searchParams.get('targetAgentProfileId') ?? undefined,
      status: status && statuses.has(status) ? (status as AgentRetirementStatus) : undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, AgentRetirementPlanBody)
    if (!parsed.ok) return parsed.response
    const agentRetirementPlan = await createAgentRetirementPlan(parsed.data)
    return NextResponse.json({ agentRetirementPlan }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
