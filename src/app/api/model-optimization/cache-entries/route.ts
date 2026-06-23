import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { ModelInvocationTaskType } from '@/db/schema'
import { listModelResponseCacheEntries } from '@/server/model-invocation-optimization-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      entries: await listModelResponseCacheEntries({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        modelProfileId: req.nextUrl.searchParams.get('modelProfileId') ?? undefined,
        taskType: (req.nextUrl.searchParams.get('taskType') ?? undefined) as
          | ModelInvocationTaskType
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
