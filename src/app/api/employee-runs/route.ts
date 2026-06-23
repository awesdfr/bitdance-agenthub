import { NextResponse } from 'next/server'

import { listRecentEmployeeRuns } from '@/server/employee-runtime-service'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const agentProfileId = url.searchParams.get('agentProfileId') ?? undefined
  const employeeRuns = await listRecentEmployeeRuns(agentProfileId)
  return NextResponse.json({ employeeRuns })
}
