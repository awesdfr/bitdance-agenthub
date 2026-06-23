import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { evaluateArchitectureEvolutionReadiness } from '@/server/architecture-evolution-service'

export async function POST() {
  try {
    return NextResponse.json(await evaluateArchitectureEvolutionReadiness())
  } catch (err) {
    return errorResponse(err)
  }
}
