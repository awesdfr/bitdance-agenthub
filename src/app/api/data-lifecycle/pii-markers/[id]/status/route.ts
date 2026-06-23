import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { PiiMarkerStatusBody } from '@/server/control-plane-validators'
import { updatePiiMarkerStatus } from '@/server/data-lifecycle-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseJsonBody(req, PiiMarkerStatusBody)
    if (!parsed.ok) return parsed.response
    const piiMarker = await updatePiiMarkerStatus(await getRouteId(ctx), parsed.data.status)
    return NextResponse.json({ piiMarker })
  } catch (err) {
    return errorResponse(err)
  }
}
