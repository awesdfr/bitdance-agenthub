import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getProductionIntegrationReadiness } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ readiness: await getProductionIntegrationReadiness() })
  } catch (err) {
    return errorResponse(err)
  }
}
