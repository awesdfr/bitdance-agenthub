import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { WorkflowTemplateInstantiationStatus } from '@/db/schema'
import { WorkflowTemplateInstantiationBody } from '@/server/control-plane-validators'
import {
  instantiateWorkflowTemplate,
  listWorkflowTemplateInstantiations,
} from '@/server/workflow-advanced-operation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      workflowTemplateInstantiations: await listWorkflowTemplateInstantiations({
        sourceWorkflowId: req.nextUrl.searchParams.get('sourceWorkflowId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | WorkflowTemplateInstantiationStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, WorkflowTemplateInstantiationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      workflowTemplateInstantiation: await instantiateWorkflowTemplate(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
