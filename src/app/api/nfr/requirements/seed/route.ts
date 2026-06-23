import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedNfrRequirements } from '@/server/nfr-requirement-service'

export async function POST() {
  try {
    return NextResponse.json({ requirements: await seedNfrRequirements() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
