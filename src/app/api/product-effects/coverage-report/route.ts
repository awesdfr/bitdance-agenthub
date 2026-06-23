import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getProductEffectsCoverageReport } from '@/server/product-effects-coverage-report-service'

export async function GET() {
  try {
    const report = await getProductEffectsCoverageReport()
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
