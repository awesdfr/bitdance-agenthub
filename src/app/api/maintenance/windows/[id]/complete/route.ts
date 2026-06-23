import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { CompleteMaintenanceWindowBody } from '@/server/control-plane-validators'
import { completeMaintenanceWindow } from '@/server/maintenance-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, CompleteMaintenanceWindowBody)
  if (!parsed.ok) return parsed.response
  try {
    const maintenanceWindow = await completeMaintenanceWindow(await getRouteId(ctx), parsed.data)
    return NextResponse.json({ maintenanceWindow })
  } catch (err) {
    return errorResponse(err, 404)
  }
}
