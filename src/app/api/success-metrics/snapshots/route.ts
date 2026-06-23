import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SuccessMetricSnapshotBody } from '@/server/control-plane-validators'
import { listSuccessMetricSnapshots, recordSuccessMetricSnapshot } from '@/server/success-metrics-service'

export async function GET(req: NextRequest) {
  try {
    const metricKey = req.nextUrl.searchParams.get('metricKey') ?? undefined
    const statusParam = req.nextUrl.searchParams.get('status') ?? undefined
    const status = statusParam === 'met' || statusParam === 'missed' || statusParam === 'observed'
      ? statusParam
      : undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      snapshots: await listSuccessMetricSnapshots({
        metricKey,
        status,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SuccessMetricSnapshotBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      snapshot: await recordSuccessMetricSnapshot(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
