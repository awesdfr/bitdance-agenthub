import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedResourceGovernorPolicy } from '@/server/resource-governor-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedResourceGovernorPolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
