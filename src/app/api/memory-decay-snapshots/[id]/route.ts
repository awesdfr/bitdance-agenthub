import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getMemoryDecaySnapshot } from '@/server/memory-decay-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    return NextResponse.json({ snapshot: await getMemoryDecaySnapshot(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}
