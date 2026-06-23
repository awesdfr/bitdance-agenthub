import { NextRequest, NextResponse } from 'next/server'

import { listSoftwareCommandRuns } from '@/server/software-adapter-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    softwareCommandRuns: await listSoftwareCommandRuns({
      softwareCommandId: req.nextUrl.searchParams.get('softwareCommandId') ?? undefined,
      softwareProfileId: req.nextUrl.searchParams.get('softwareProfileId') ?? undefined,
      agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
      workflowRunId: req.nextUrl.searchParams.get('workflowRunId') ?? undefined,
    }),
  })
}
