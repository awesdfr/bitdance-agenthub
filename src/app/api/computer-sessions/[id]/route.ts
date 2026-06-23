import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getComputerSessionTimeline } from '@/server/computer-session-manager'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await getComputerSessionTimeline(await getRouteId(ctx)))
  } catch (err) {
    return errorResponse(err)
  }
}
