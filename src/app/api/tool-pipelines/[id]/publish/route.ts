import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { publishToolPipeline } from '@/server/skill-synthesis-service'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({ pipeline: await publishToolPipeline(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}
