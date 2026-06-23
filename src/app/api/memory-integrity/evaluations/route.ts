import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { MemoryIntegrityDecision } from '@/db/schema'
import { listMemoryIntegrityEvaluations } from '@/server/memory-integrity-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listMemoryIntegrityEvaluations({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        memoryItemId: req.nextUrl.searchParams.get('memoryItemId') ?? undefined,
        decision: (req.nextUrl.searchParams.get('decision') ?? undefined) as
          | MemoryIntegrityDecision
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
