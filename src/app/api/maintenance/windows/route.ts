import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MaintenanceWindowBody } from '@/server/control-plane-validators'
import { listMaintenanceWindows, startMaintenanceWindow } from '@/server/maintenance-service'

export async function GET() {
  return NextResponse.json({ maintenanceWindows: await listMaintenanceWindows() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, MaintenanceWindowBody)
  if (!parsed.ok) return parsed.response
  try {
    const maintenanceWindow = await startMaintenanceWindow(parsed.data)
    return NextResponse.json({ maintenanceWindow }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
