import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { buildAgentEnvironment } from '@/server/agent-environment-service'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const employeeRunId = req.nextUrl.searchParams.get('employeeRunId')
    return NextResponse.json({
      environment: await buildAgentEnvironment({
        agentProfileId: await getRouteId(ctx),
        employeeRunId,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
