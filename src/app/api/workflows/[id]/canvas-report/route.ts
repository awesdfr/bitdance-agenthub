import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getWorkflowCanvasReport } from '@/server/workflow-canvas-report-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const report = await getWorkflowCanvasReport(await getRouteId(ctx))
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err)
  }
}
