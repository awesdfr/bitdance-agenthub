import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { disablePlugin } from '@/server/plugin-framework-service'

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({ plugin: await disablePlugin(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}
