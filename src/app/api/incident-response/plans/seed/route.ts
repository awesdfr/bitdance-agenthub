import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedIncidentResponsePlans } from '@/server/incident-response-service'

export async function POST() {
  try {
    return NextResponse.json({ plans: await seedIncidentResponsePlans() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
