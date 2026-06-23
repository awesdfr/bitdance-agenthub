import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { ResourceGovernorStatus } from '@/db/schema'
import { listResourceGovernorEvaluations } from '@/server/resource-governor-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listResourceGovernorEvaluations({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | ResourceGovernorStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
