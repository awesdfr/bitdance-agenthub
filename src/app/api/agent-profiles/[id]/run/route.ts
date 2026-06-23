import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { startEmployeeRun } from '@/server/employee-runtime-service'
import { EmployeeRunBody } from '@/server/control-plane-validators'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, EmployeeRunBody)
  if (!parsed.ok) return parsed.response
  try {
    const employeeRun = await startEmployeeRun({
      ...parsed.data,
      agentProfileId: await getRouteId(ctx),
    })
    return NextResponse.json({ employeeRun }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
