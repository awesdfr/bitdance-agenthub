import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { ContentSafetyScanStatus } from '@/db/schema'
import { listContentSafetyScans } from '@/server/content-safety-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      scans: await listContentSafetyScans({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | ContentSafetyScanStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
