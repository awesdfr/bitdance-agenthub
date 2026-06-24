import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { deleteModelProfile, updateModelProfile } from '@/server/control-plane-service'
import { ModelProfileBody } from '@/server/control-plane-validators'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, ModelProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    const modelProfile = await updateModelProfile(await getRouteId(ctx), parsed.data)
    return NextResponse.json({ modelProfile })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    await deleteModelProfile(await getRouteId(ctx))
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
