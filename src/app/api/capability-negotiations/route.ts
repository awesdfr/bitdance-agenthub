import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { CapabilityNegotiationStatus } from '@/db/schema'
import { CapabilityNegotiationBody } from '@/server/control-plane-validators'
import {
  createCapabilityNegotiation,
  listCapabilityNegotiations,
} from '@/server/capability-negotiation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      negotiations: await listCapabilityNegotiations({
        requesterAgentProfileId: req.nextUrl.searchParams.get('requesterAgentProfileId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | CapabilityNegotiationStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, CapabilityNegotiationBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { snapshot: await createCapabilityNegotiation(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
