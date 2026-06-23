import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { revokeProgrammaticApiKey } from '@/server/programmatic-api-service'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const programmaticApiKey = await revokeProgrammaticApiKey(await getRouteId(ctx))
    return NextResponse.json({ programmaticApiKey })
  } catch (err) {
    return errorResponse(err)
  }
}
