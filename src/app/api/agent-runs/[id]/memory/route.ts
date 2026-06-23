import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { listMemoryForRun } from '@/server/control-plane-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const memoryItems = await listMemoryForRun(await getRouteId(ctx))
    return NextResponse.json({ memoryItems })
  } catch (err) {
    return errorResponse(err)
  }
}
