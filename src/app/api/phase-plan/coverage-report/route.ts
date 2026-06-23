import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getPhasePlanCoverageReport } from '@/server/phase-plan-coverage-report-service'

export async function GET() {
  try {
    const report = await getPhasePlanCoverageReport()
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
