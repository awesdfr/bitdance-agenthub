import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getFrontendPageCoverageReport } from '@/server/frontend-page-coverage-report-service'

export async function GET() {
  try {
    const report = await getFrontendPageCoverageReport()
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
