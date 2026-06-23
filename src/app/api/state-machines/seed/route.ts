import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedEntityStateMachines } from '@/server/entity-state-machine-service'

export async function POST() {
  try {
    return NextResponse.json(await seedEntityStateMachines(), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
