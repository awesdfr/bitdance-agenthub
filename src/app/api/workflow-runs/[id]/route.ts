import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getWorkflowRunSnapshot } from '@/server/control-plane-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const snapshot = await getWorkflowRunSnapshot(await getRouteId(ctx))
    return NextResponse.json(snapshot)
  } catch (err) {
    return errorResponse(err, 404)
  }
}
