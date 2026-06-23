import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { createDebugReplaySnapshotForEmployeeRun } from '@/server/observability-service'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const debugReplaySnapshot = await createDebugReplaySnapshotForEmployeeRun(await getRouteId(ctx))
    return NextResponse.json({ debugReplaySnapshot }, { status: 201 })
  } catch (err) {
    return errorResponse(err, 404)
  }
}
