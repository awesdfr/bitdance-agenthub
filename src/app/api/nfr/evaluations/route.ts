import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { NfrEvaluationStatus } from '@/db/schema'
import { listNfrEvaluations } from '@/server/nfr-requirement-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listNfrEvaluations({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | NfrEvaluationStatus
          | undefined,
        requirementId: req.nextUrl.searchParams.get('requirementId') ?? undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
