import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { BenchmarkRunBody } from '@/server/control-plane-validators'
import { listBenchmarkRuns, runBenchmarkSuite } from '@/server/benchmark-suite-service'

export async function GET() {
  try {
    return NextResponse.json({ runs: await listBenchmarkRuns() })
  } catch (err) {
    return errorResponse(err, 500)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, BenchmarkRunBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await runBenchmarkSuite(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
