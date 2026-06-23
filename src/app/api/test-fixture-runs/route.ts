import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listTestFixtureGenerationRuns } from '@/server/test-fixture-service'

export async function GET() {
  try {
    return NextResponse.json({ runs: await listTestFixtureGenerationRuns() })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
