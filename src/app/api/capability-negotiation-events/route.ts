import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { CapabilityNegotiationEventType } from '@/db/schema'
import { listCapabilityNegotiationEvents } from '@/server/capability-negotiation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      events: await listCapabilityNegotiationEvents({
        negotiationId: req.nextUrl.searchParams.get('negotiationId') ?? undefined,
        eventType: (req.nextUrl.searchParams.get('eventType') ?? undefined) as
          | CapabilityNegotiationEventType
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
