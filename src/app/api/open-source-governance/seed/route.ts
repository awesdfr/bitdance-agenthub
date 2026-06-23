import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedOpenSourceGovernance } from '@/server/open-source-governance-service'

export async function POST() {
  try {
    const governance = await seedOpenSourceGovernance()
    return NextResponse.json(governance, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
