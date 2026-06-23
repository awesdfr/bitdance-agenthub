import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { WorkflowPreflightBody } from '@/server/control-plane-validators'
import { runWorkflowPreflight } from '@/server/workflow-preflight-service'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const parsed = await parseJsonBody(req, WorkflowPreflightBody)
    if (!parsed.ok) return parsed.response
    const workflowPreflight = await runWorkflowPreflight({
      workflowId: await getRouteId(ctx),
      input: parsed.data.input,
      budgetLimitCents: parsed.data.budgetLimitCents,
    })
    return NextResponse.json({ workflowPreflight }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
