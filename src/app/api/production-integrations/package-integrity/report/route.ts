import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getProductionPackageIntegrityReport } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ report: await getProductionPackageIntegrityReport() })
  } catch (err) {
    return errorResponse(err)
  }
}
