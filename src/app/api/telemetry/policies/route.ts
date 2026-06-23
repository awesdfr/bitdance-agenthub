import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TelemetryPolicyBody } from '@/server/control-plane-validators'
import { createTelemetryPolicy, listTelemetryPolicies } from '@/server/telemetry-policy-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      policies: await listTelemetryPolicies({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | 'active'
          | 'disabled'
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 25),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, TelemetryPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ policy: await createTelemetryPolicy(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
