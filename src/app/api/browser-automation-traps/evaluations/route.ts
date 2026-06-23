import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { BrowserAutomationTrapStatus } from '@/db/schema'
import { listBrowserAutomationTrapEvaluations } from '@/server/browser-automation-trap-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listBrowserAutomationTrapEvaluations({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | BrowserAutomationTrapStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
