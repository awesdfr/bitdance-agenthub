import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedCompetitivePositioningReport } from '@/server/competitive-positioning-service'

export async function POST() {
  try {
    return NextResponse.json(
      { report: await seedCompetitivePositioningReport() },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
