import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { PromptDriftRunStatus } from '@/db/schema'
import { listPromptDriftRuns } from '@/server/prompt-drift-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      runs: await listPromptDriftRuns({
        monitorId: req.nextUrl.searchParams.get('monitorId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | PromptDriftRunStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
