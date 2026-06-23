import { NextRequest, NextResponse } from 'next/server'

import { listCliRuns } from '@/server/cli-runner-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    cliRuns: await listCliRuns({
      cliProfileId: req.nextUrl.searchParams.get('cliProfileId') ?? undefined,
      agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
      employeeRunId: req.nextUrl.searchParams.get('employeeRunId') ?? undefined,
    }),
  })
}
