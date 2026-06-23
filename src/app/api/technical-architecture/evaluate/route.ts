import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { evaluateTechnicalArchitecture } from '@/server/technical-architecture-service'

export async function POST() {
  try {
    return NextResponse.json({ evaluation: await evaluateTechnicalArchitecture() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
