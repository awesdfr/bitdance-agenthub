import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ConsensusCriticalTask, ConsensusRecommendedAction } from '@/db/schema'
import { DualModelVerificationBody } from '@/server/control-plane-validators'
import {
  createDualModelVerification,
  listDualModelVerifications,
} from '@/server/consensus-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      verifications: await listDualModelVerifications({
        appliesTo: (req.nextUrl.searchParams.get('appliesTo') ?? undefined) as
          | ConsensusCriticalTask
          | undefined,
        recommendedAction: (req.nextUrl.searchParams.get('recommendedAction') ?? undefined) as
          | ConsensusRecommendedAction
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, DualModelVerificationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      verification: await createDualModelVerification(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
