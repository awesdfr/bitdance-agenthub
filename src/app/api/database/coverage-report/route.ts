import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getDatabaseCoverageReport } from '@/server/database-coverage-report-service'

export async function GET() {
  try {
    const report = await getDatabaseCoverageReport()
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
