import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listCapacityPlanningProfiles } from '@/server/capacity-planning-service'

export async function GET() {
  try {
    return NextResponse.json({ profiles: await listCapacityPlanningProfiles() })
  } catch (err) {
    return errorResponse(err)
  }
}
