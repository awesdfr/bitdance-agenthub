import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { testCliProfile } from '@/server/control-plane-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const result = await testCliProfile(await getRouteId(ctx))
    return NextResponse.json({ result })
  } catch (err) {
    return errorResponse(err)
  }
}
