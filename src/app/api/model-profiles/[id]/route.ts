import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { deleteModelProfile } from '@/server/control-plane-service'

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    await deleteModelProfile(await getRouteId(ctx))
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
