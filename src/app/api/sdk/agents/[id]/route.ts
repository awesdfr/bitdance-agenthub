import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getSdkAgent } from '@/server/programmatic-api-service'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({ agentProfile: await getSdkAgent(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}
