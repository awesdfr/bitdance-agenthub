import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { BudgetUsageGroupBy } from '@/db/schema'
import { buildBudgetUsageReport } from '@/server/budget-control-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      report: await buildBudgetUsageReport({
        groupBy: (req.nextUrl.searchParams.get('groupBy') ?? undefined) as
          | BudgetUsageGroupBy
          | undefined,
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        projectId: req.nextUrl.searchParams.get('projectId') ?? undefined,
        from: numberParam(req.nextUrl.searchParams.get('from')),
        to: numberParam(req.nextUrl.searchParams.get('to')),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

function numberParam(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
