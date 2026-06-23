import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TelemetryExportBody } from '@/server/control-plane-validators'
import { exportTelemetryData } from '@/server/telemetry-policy-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, TelemetryExportBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ exportManifest: await exportTelemetryData(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
