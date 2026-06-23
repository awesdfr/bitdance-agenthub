import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { TechnicalArchitectureEvaluationStatus } from '@/db/schema'
import { listTechnicalArchitectureEvaluations } from '@/server/technical-architecture-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listTechnicalArchitectureEvaluations({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | TechnicalArchitectureEvaluationStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 25),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
