import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listCicdRuns } from '@/server/cicd-integration-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      runs: await listCicdRuns(req.nextUrl.searchParams.get('integrationId') ?? undefined),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
