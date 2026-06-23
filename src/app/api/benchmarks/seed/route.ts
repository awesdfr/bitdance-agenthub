import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedBenchmarkSuite } from '@/server/benchmark-suite-service'

export async function POST() {
  try {
    return NextResponse.json(await seedBenchmarkSuite(), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
