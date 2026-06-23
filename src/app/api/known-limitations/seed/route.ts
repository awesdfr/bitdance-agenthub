import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedKnownLimitations } from '@/server/known-limitation-service'

export async function POST() {
  try {
    return NextResponse.json({ limitations: await seedKnownLimitations() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
