import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listDeprecationMigrationRuns } from '@/server/deprecation-policy-service'

export async function GET(req: NextRequest) {
  try {
    const featureDeprecationId = req.nextUrl.searchParams.get('featureDeprecationId') ?? undefined
    return NextResponse.json({
      migrationRuns: await listDeprecationMigrationRuns({ featureDeprecationId }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
