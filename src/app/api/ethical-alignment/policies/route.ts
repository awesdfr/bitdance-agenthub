import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { EthicalAlignmentPolicyStatus } from '@/db/schema'
import { EthicalAlignmentPolicyBody } from '@/server/control-plane-validators'
import {
  createEthicalAlignmentPolicy,
  listEthicalAlignmentPolicies,
} from '@/server/ethical-alignment-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      policies: await listEthicalAlignmentPolicies({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | EthicalAlignmentPolicyStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, EthicalAlignmentPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { policy: await createEthicalAlignmentPolicy(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
