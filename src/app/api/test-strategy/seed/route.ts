import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedTestStrategyItems } from '@/server/test-strategy-service'

export async function POST() {
  try {
    return NextResponse.json({ items: await seedTestStrategyItems() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
