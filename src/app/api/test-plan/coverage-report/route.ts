import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getTestPlanCoverageReport } from '@/server/test-plan-coverage-report-service'

export async function GET() {
  try {
    const report = await getTestPlanCoverageReport()
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
