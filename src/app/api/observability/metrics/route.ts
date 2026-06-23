import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MetricPointBody } from '@/server/control-plane-validators'
import { listMetricPoints, recordMetricPoint } from '@/server/observability-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    metricPoints: await listMetricPoints(req.nextUrl.searchParams.get('metricName') ?? undefined),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, MetricPointBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await recordMetricPoint(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
