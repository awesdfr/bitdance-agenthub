import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getRunReflection } from '@/server/control-plane-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const reflection = await getRunReflection(await getRouteId(ctx))
    return NextResponse.json({ reflection })
  } catch (err) {
    return errorResponse(err)
  }
}
