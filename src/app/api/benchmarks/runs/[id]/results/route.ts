import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { listBenchmarkCaseResults } from '@/server/benchmark-suite-service'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({
      results: await listBenchmarkCaseResults({ runId: await getRouteId(ctx) }),
    })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
