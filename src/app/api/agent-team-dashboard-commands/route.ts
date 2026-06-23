import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listAgentTeamDashboardCommands } from '@/server/agent-team-dashboard-service'

export async function GET(req: NextRequest) {
  try {
    const dashboardSnapshotId = req.nextUrl.searchParams.get('dashboardSnapshotId') ?? undefined
    const commandTypeParam = req.nextUrl.searchParams.get('commandType')
    const commandType =
      commandTypeParam === 'pause_all' ||
      commandTypeParam === 'resume_all' ||
      commandTypeParam === 'emergency_stop' ||
      commandTypeParam === 'export_report'
        ? commandTypeParam
        : undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      commands: await listAgentTeamDashboardCommands({
        dashboardSnapshotId,
        commandType,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
