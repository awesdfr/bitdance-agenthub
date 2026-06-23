import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getSdkTask } from '@/server/programmatic-api-service'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await getSdkTask(await getRouteId(ctx)))
  } catch (err) {
    return errorResponse(err)
  }
}
