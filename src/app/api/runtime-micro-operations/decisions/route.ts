import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { RuntimeMicroOperationDecisionStatus } from '@/db/schema'
import { listRuntimeMicroOperationDecisions } from '@/server/runtime-micro-operation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      decisions: await listRuntimeMicroOperationDecisions({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | RuntimeMicroOperationDecisionStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
