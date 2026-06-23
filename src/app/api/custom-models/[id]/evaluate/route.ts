import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { CustomModelEvaluationBody } from '@/server/control-plane-validators'
import { evaluateCustomModel } from '@/server/custom-model-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, CustomModelEvaluationBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      evaluation: await evaluateCustomModel({
        customModelId: await getRouteId(ctx),
        ...parsed.data,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
