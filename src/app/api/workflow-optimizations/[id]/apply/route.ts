import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { WorkflowOptimizationApplyBody } from '@/server/control-plane-validators'
import { applyWorkflowOptimization } from '@/server/workflow-optimization-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, WorkflowOptimizationApplyBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      workflowOptimization: await applyWorkflowOptimization(await getRouteId(ctx), parsed.data.riskThreshold),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
