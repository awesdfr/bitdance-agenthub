import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ComputerActionEventBody } from '@/server/control-plane-validators'
import { recordComputerSessionAction } from '@/server/computer-session-manager'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseJsonBody(req, ComputerActionEventBody)
    if (!parsed.ok) return parsed.response
    const action = await recordComputerSessionAction(await getRouteId(ctx), parsed.data)
    return NextResponse.json({ action }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
