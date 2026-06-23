import { NextResponse } from 'next/server'

import { listWorkflowRuns } from '@/server/control-plane-service'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const workflowId = url.searchParams.get('workflowId') ?? undefined
  const workflowRuns = await listWorkflowRuns(workflowId)
  return NextResponse.json({ workflowRuns })
}
