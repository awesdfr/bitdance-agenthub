import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { EthicalAlignmentDecision } from '@/db/schema'
import { listEthicalAlignmentEvaluations } from '@/server/ethical-alignment-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listEthicalAlignmentEvaluations({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        decision: (req.nextUrl.searchParams.get('decision') ?? undefined) as
          | EthicalAlignmentDecision
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
