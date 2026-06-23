import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getBackendServiceCoverageReport } from '@/server/backend-service-coverage-report-service'

export async function GET() {
  try {
    const report = await getBackendServiceCoverageReport()
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
