import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getProductionOnsiteIntakeChecklist } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ checklist: await getProductionOnsiteIntakeChecklist() })
  } catch (err) {
    return errorResponse(err)
  }
}
