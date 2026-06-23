import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { DecisionRollbackStatus } from '@/db/schema'
import { DecisionRollbackBody } from '@/server/control-plane-validators'
import {
  applyDecisionRollback,
  createDecisionRollback,
  listDecisionRollbacks,
} from '@/server/decision-rollback-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      decisionRollbacks: await listDecisionRollbacks({
        employeeRunId: req.nextUrl.searchParams.get('employeeRunId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | DecisionRollbackStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, DecisionRollbackBody)
    if (!parsed.ok) return parsed.response
    const rollback = await createDecisionRollback(parsed.data)
    if (!parsed.data.applyImmediately) return NextResponse.json({ decisionRollback: rollback }, { status: 201 })
    return NextResponse.json(
      { decisionRollback: await applyDecisionRollback({ rollbackId: rollback.id }) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
