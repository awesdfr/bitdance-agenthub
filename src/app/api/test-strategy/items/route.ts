import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { TestStrategyItemKind, TestStrategyItemStatus } from '@/db/schema'
import { listTestStrategyItems } from '@/server/test-strategy-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      items: await listTestStrategyItems({
        kind: (req.nextUrl.searchParams.get('kind') ?? undefined) as
          | TestStrategyItemKind
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | TestStrategyItemStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
