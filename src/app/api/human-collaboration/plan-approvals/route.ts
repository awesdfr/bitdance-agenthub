import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { PlanApprovalResultBody } from '@/server/control-plane-validators'
import {
  listPlanApprovalResults,
  recordPlanApprovalResult,
} from '@/server/human-collaboration-service'

export async function GET(req: NextRequest) {
  try {
    const approvalRequestId = req.nextUrl.searchParams.get('approvalRequestId') ?? undefined
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const employeeRunId = req.nextUrl.searchParams.get('employeeRunId') ?? undefined
    const workflowRunId = req.nextUrl.searchParams.get('workflowRunId') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      results: await listPlanApprovalResults({
        approvalRequestId,
        agentProfileId,
        employeeRunId,
        workflowRunId,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, PlanApprovalResultBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { result: await recordPlanApprovalResult(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
