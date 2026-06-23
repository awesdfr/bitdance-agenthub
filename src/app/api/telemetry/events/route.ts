import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { TelemetryDecisionStatus } from '@/db/schema'
import { listTelemetryEvents } from '@/server/telemetry-policy-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      events: await listTelemetryEvents({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | TelemetryDecisionStatus
          | undefined,
        eventType: req.nextUrl.searchParams.get('eventType') ?? undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
