import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedEcosystemRoadmapPhases } from '@/server/ecosystem-roadmap-service'

export async function POST() {
  try {
    return NextResponse.json(
      { phases: await seedEcosystemRoadmapPhases() },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
