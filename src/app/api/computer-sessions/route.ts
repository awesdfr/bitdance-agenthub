import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listComputerSessions } from '@/server/computer-session-manager'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    return NextResponse.json({
      computerSessions: await listComputerSessions({
        employeeRunId: searchParams.get('employeeRunId') ?? undefined,
        workflowRunId: searchParams.get('workflowRunId') ?? undefined,
        agentProfileId: searchParams.get('agentProfileId') ?? undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
