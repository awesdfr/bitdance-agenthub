import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listIncidentResponsePlans } from '@/server/incident-response-service'

export async function GET() {
  try {
    return NextResponse.json({ plans: await listIncidentResponsePlans() })
  } catch (err) {
    return errorResponse(err)
  }
}
