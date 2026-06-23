import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { BudgetEvaluationStatus } from '@/db/schema'
import { listBudgetEvaluations } from '@/server/budget-control-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listBudgetEvaluations({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        projectId: req.nextUrl.searchParams.get('projectId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | BudgetEvaluationStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
