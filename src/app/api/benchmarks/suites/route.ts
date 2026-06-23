import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listBenchmarkSuites } from '@/server/benchmark-suite-service'

export async function GET() {
  try {
    return NextResponse.json({ suites: await listBenchmarkSuites() })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
