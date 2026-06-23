import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getProductionOnsiteActivationGuide } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ guide: await getProductionOnsiteActivationGuide() })
  } catch (err) {
    return errorResponse(err)
  }
}
