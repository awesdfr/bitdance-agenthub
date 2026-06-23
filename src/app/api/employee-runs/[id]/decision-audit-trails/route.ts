import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { listDecisionAuditTrails } from '@/server/employee-runtime-service'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    return NextResponse.json({
      decisionAuditTrails: await listDecisionAuditTrails(await getRouteId(ctx)),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
