import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { CustomMetricEvaluationBody } from '@/server/control-plane-validators'
import { evaluateCustomMetricProfile } from '@/server/custom-metrics-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, CustomMetricEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    const customMetricEvaluation = await evaluateCustomMetricProfile(await getRouteId(ctx), parsed.data)
    return NextResponse.json({ customMetricEvaluation }, { status: 201 })
  } catch (err) {
    return errorResponse(err, 404)
  }
}
