import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { markNotificationRead } from '@/server/notification-service'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const notification = await markNotificationRead(await getRouteId(ctx))
    return NextResponse.json({ notification })
  } catch (err) {
    return errorResponse(err, 404)
  }
}
