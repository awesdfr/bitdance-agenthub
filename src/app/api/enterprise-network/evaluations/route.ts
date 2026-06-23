import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { EnterpriseNetworkStatus } from '@/db/schema'
import { listEnterpriseNetworkEvaluations } from '@/server/enterprise-network-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listEnterpriseNetworkEvaluations({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | EnterpriseNetworkStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
