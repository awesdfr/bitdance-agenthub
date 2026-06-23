import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listTelemetryExportManifests } from '@/server/telemetry-policy-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      exports: await listTelemetryExportManifests({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 25),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
