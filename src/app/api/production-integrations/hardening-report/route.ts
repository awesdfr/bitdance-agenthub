import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getProductionHardeningReport } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ report: await getProductionHardeningReport() })
  } catch (err) {
    return errorResponse(err)
  }
}
