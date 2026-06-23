import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { DecisionRollbackApplyBody } from '@/server/control-plane-validators'
import { applyDecisionRollback } from '@/server/decision-rollback-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, DecisionRollbackApplyBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      decisionRollback: await applyDecisionRollback({
        rollbackId: await getRouteId(ctx),
        note: parsed.data.note,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
