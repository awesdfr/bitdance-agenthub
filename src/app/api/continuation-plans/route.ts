import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ContinuationPlanStatus } from '@/db/schema'
import { ContinuationPlanBody } from '@/server/control-plane-validators'
import {
  createContinuationPlan,
  listContinuationPlans,
} from '@/server/agent-continuity-service'

const statuses = new Set(['open', 'in_progress', 'completed', 'canceled'])

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    continuationPlans: await listContinuationPlans({
      agentProfileId: searchParams.get('agentProfileId') ?? undefined,
      sourceRunId: searchParams.get('sourceRunId') ?? undefined,
      status: status && statuses.has(status) ? (status as ContinuationPlanStatus) : undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ContinuationPlanBody)
    if (!parsed.ok) return parsed.response
    const continuationPlan = await createContinuationPlan(parsed.data)
    return NextResponse.json({ continuationPlan }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
