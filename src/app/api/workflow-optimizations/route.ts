import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { WorkflowOptimizationStatus } from '@/db/schema'
import { WorkflowOptimizationBody } from '@/server/control-plane-validators'
import {
  analyzeWorkflowOptimization,
  listWorkflowOptimizations,
} from '@/server/workflow-optimization-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      workflowOptimizations: await listWorkflowOptimizations({
        workflowId: req.nextUrl.searchParams.get('workflowId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | WorkflowOptimizationStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, WorkflowOptimizationBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { workflowOptimization: await analyzeWorkflowOptimization(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
