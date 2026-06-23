import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { applyMemoryDecayAction } from '@/server/memory-decay-service'
import { MemoryDecayActionBody } from '@/server/control-plane-validators'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, MemoryDecayActionBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      snapshot: await applyMemoryDecayAction(await getRouteId(ctx), parsed.data),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
