import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { enablePlugin } from '@/server/plugin-framework-service'

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({ plugin: await enablePlugin(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}
