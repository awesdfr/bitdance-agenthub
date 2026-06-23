import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { evaluateBudget } from '@/server/budget-control-service'
import { BudgetEvaluationBody } from '@/server/control-plane-validators'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, BudgetEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ evaluation: await evaluateBudget(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
