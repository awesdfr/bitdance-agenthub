import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AbusePreventionSeverity } from '@/db/schema'
import { AbuseDetectionBody } from '@/server/control-plane-validators'
import {
  evaluateAbuseSignals,
  listAbuseDetectionEvents,
} from '@/server/abuse-prevention-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    abuseDetectionEvents: await listAbuseDetectionEvents({
      policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
      agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
      severity: (req.nextUrl.searchParams.get('severity') ?? undefined) as
        | AbusePreventionSeverity
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AbuseDetectionBody)
  if (!parsed.ok) return parsed.response
  try {
    const abuseDetectionEvent = await evaluateAbuseSignals(parsed.data)
    return NextResponse.json({ abuseDetectionEvent }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
