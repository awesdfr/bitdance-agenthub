import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedDefaultTestFixtures } from '@/server/test-fixture-service'

export async function POST() {
  try {
    return NextResponse.json({ fixtures: await seedDefaultTestFixtures() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
