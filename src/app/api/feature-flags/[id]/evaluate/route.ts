import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { FeatureFlagEvaluationBody } from '@/server/control-plane-validators'
import { evaluateFeatureFlag } from '@/server/feature-flag-service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, FeatureFlagEvaluationBody)
    if (!parsed.ok) return parsed.response
    const { id } = await params
    const evaluation = await evaluateFeatureFlag(id, parsed.data)
    return NextResponse.json({ evaluation }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
