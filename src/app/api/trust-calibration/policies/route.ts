import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { TrustCalibrationPolicyStatus } from '@/db/schema'
import { TrustCalibrationPolicyBody } from '@/server/control-plane-validators'
import {
  createTrustCalibrationPolicy,
  listTrustCalibrationPolicies,
} from '@/server/trust-calibration-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      policies: await listTrustCalibrationPolicies({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | TrustCalibrationPolicyStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, TrustCalibrationPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ policy: await createTrustCalibrationPolicy(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
