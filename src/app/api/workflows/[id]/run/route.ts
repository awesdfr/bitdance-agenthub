import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { startWorkflowRun } from '@/server/control-plane-service'
import { WorkflowRunBody } from '@/server/control-plane-validators'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, WorkflowRunBody)
  if (!parsed.ok) return parsed.response
  try {
    const workflowRun = await startWorkflowRun(await getRouteId(ctx), parsed.data.input)
    return NextResponse.json({ workflowRun }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
