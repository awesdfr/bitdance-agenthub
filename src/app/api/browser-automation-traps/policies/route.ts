import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listBrowserAutomationTrapPolicies } from '@/server/browser-automation-trap-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      policies: await listBrowserAutomationTrapPolicies({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | 'active'
          | 'disabled'
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 25),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
