import { NextRequest, NextResponse } from 'next/server'

import { listWorkflowPreflights } from '@/server/workflow-preflight-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return NextResponse.json({
    workflowPreflights: await listWorkflowPreflights(searchParams.get('workflowId') ?? undefined),
  })
}
