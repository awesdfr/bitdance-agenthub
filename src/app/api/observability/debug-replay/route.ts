import { NextRequest, NextResponse } from 'next/server'

import { listDebugReplaySnapshots } from '@/server/observability-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    debugReplaySnapshots: await listDebugReplaySnapshots(
      req.nextUrl.searchParams.get('resourceType') ?? undefined,
      req.nextUrl.searchParams.get('resourceId') ?? undefined,
    ),
  })
}
