import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedArchitecturePatterns } from '@/server/architecture-pattern-service'

export async function POST() {
  try {
    const architecture = await seedArchitecturePatterns()
    return NextResponse.json(architecture, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
