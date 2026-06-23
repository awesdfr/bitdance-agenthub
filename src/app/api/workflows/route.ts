import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { createWorkflow, listWorkflows } from '@/server/control-plane-service'
import { WorkflowBody } from '@/server/control-plane-validators'

export async function GET() {
  return NextResponse.json({ workflows: await listWorkflows() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, WorkflowBody)
  if (!parsed.ok) return parsed.response
  try {
    const workflow = await createWorkflow(parsed.data)
    return NextResponse.json({ workflow }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
