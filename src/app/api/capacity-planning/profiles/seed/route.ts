import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedCapacityPlanningProfiles } from '@/server/capacity-planning-service'

export async function POST() {
  try {
    return NextResponse.json({ profiles: await seedCapacityPlanningProfiles() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
