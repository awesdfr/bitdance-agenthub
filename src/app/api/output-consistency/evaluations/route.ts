import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { OutputConsistencyStatus } from '@/db/schema'
import { listOutputConsistencyEvaluations } from '@/server/output-consistency-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listOutputConsistencyEvaluations({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | OutputConsistencyStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
