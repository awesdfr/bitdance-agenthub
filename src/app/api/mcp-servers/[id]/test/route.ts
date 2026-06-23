import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { testMcpServer } from '@/server/control-plane-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const result = await testMcpServer(await getRouteId(ctx))
    return NextResponse.json({ result })
  } catch (err) {
    return errorResponse(err)
  }
}
