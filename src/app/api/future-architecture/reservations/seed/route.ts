import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedArchitectureEvolutionReservations } from '@/server/architecture-evolution-service'

export async function POST() {
  try {
    return NextResponse.json({ reservations: await seedArchitectureEvolutionReservations() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
