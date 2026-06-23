import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { recordComputerObservation } from '@/server/computer-session-manager'
import { ComputerObservationBody } from '@/server/control-plane-validators'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseJsonBody(req, ComputerObservationBody)
    if (!parsed.ok) return parsed.response
    const action = await recordComputerObservation(await getRouteId(ctx), parsed.data)
    return NextResponse.json({ action }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
