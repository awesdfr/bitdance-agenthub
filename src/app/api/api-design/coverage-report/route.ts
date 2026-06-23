import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getApiDesignCoverageReport } from '@/server/api-design-coverage-report-service'

export async function GET() {
  try {
    const report = await getApiDesignCoverageReport()
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
