import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { ModelOptimizationEventType } from '@/db/schema'
import { listModelInvocationOptimizationEvents } from '@/server/model-invocation-optimization-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      events: await listModelInvocationOptimizationEvents({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        eventType: (req.nextUrl.searchParams.get('eventType') ?? undefined) as
          | ModelOptimizationEventType
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
