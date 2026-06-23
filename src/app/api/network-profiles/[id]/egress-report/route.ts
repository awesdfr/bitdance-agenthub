import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getNetworkProfileEgressReport } from '@/server/network-egress-report-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const report = await getNetworkProfileEgressReport(await getRouteId(ctx))
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err)
  }
}
