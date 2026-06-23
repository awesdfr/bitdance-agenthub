import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getEmployeeRunRecoverySummary } from '@/server/recovery-service'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await getEmployeeRunRecoverySummary(await getRouteId(ctx)))
  } catch (err) {
    return errorResponse(err, 404)
  }
}
