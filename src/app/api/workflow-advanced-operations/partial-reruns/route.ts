import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { WorkflowPartialRerunStatus } from '@/db/schema'
import { WorkflowPartialRerunBody } from '@/server/control-plane-validators'
import {
  listPartialWorkflowReruns,
  planPartialWorkflowRerun,
} from '@/server/workflow-advanced-operation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      partialReruns: await listPartialWorkflowReruns({
        workflowRunId: req.nextUrl.searchParams.get('workflowRunId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | WorkflowPartialRerunStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, WorkflowPartialRerunBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      partialRerun: await planPartialWorkflowRerun(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
