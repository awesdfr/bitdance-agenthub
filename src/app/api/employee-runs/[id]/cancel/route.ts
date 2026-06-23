import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { cancelEmployeeRun } from '@/server/employee-runtime-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const employeeRun = await cancelEmployeeRun(await getRouteId(ctx))
    return NextResponse.json({ employeeRun })
  } catch (err) {
    return errorResponse(err)
  }
}
