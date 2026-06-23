import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedDataMaintenancePolicy } from '@/server/data-maintenance-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedDataMaintenancePolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
