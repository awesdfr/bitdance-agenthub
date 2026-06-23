import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { BenchmarkDimension } from '@/db/schema'
import { listBenchmarkCases } from '@/server/benchmark-suite-service'

const dimensions = new Set(['accuracy', 'efficiency', 'robustness', 'safety', 'consistency'])

export async function GET(req: NextRequest) {
  try {
    const dimension = req.nextUrl.searchParams.get('dimension')
    const suiteId = req.nextUrl.searchParams.get('suiteId') ?? undefined
    if (dimension && !dimensions.has(dimension)) throw new Error(`Invalid benchmark dimension: ${dimension}`)
    return NextResponse.json({
      cases: await listBenchmarkCases({
        suiteId,
        dimension: dimension as BenchmarkDimension | undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
