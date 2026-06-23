import { NextRequest, NextResponse } from 'next/server'

import { listCustomMetricEvaluations } from '@/server/custom-metrics-service'

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '100')
  return NextResponse.json({ customMetricEvaluations: await listCustomMetricEvaluations(limit) })
}
