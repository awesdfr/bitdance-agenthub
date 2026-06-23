import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { GlobalOSIntegrationStatus } from '@/db/schema'
import { listGlobalOSIntegrationEvaluations } from '@/server/global-os-integration-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listGlobalOSIntegrationEvaluations({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | GlobalOSIntegrationStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
