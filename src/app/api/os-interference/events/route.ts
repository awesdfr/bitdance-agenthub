import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { OSInterferenceEventStatus, OSInterferenceSignal } from '@/db/schema'
import { listOSInterferenceEvents } from '@/server/os-interference-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      events: await listOSInterferenceEvents({
        signal: (req.nextUrl.searchParams.get('signal') ?? undefined) as
          | OSInterferenceSignal
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | OSInterferenceEventStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
