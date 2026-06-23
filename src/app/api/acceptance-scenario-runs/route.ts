import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { AcceptanceScenarioKey, AcceptanceScenarioStatus } from '@/db/schema'
import { listAcceptanceScenarioRuns } from '@/server/acceptance-test-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      acceptanceScenarioRuns: await listAcceptanceScenarioRuns({
        scenarioKey: (req.nextUrl.searchParams.get('scenarioKey') ?? undefined) as
          | AcceptanceScenarioKey
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | AcceptanceScenarioStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
