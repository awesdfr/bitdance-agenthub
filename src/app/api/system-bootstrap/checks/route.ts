import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { SystemBootstrapCheckStatus, SystemBootstrapComponent } from '@/db/schema'
import { listSystemBootstrapChecks } from '@/server/system-bootstrap-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      checks: await listSystemBootstrapChecks({
        runId: req.nextUrl.searchParams.get('runId') ?? undefined,
        component: (req.nextUrl.searchParams.get('component') ?? undefined) as
          | SystemBootstrapComponent
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | SystemBootstrapCheckStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
