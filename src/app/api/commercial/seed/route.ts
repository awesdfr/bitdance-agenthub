import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedCommercialStrategy } from '@/server/pricing-strategy-service'

export async function POST() {
  try {
    const strategy = await seedCommercialStrategy()
    return NextResponse.json(strategy, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
