import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { ConfigEntityType } from '@/db/schema'
import { listOptimisticLocks } from '@/server/optimistic-lock-service'

export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams
    return NextResponse.json({
      optimisticLocks: await listOptimisticLocks({
        entityType: (params.get('entityType') || undefined) as ConfigEntityType | undefined,
        entityId: params.get('entityId') || undefined,
        limit: Number(params.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
