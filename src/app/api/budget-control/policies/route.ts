import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { BudgetPolicyStatus, BudgetScope } from '@/db/schema'
import { BudgetPolicyBody } from '@/server/control-plane-validators'
import { createBudgetPolicy, listBudgetPolicies } from '@/server/budget-control-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      policies: await listBudgetPolicies({
        scope: (req.nextUrl.searchParams.get('scope') ?? undefined) as BudgetScope | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | BudgetPolicyStatus
          | undefined,
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        projectId: req.nextUrl.searchParams.get('projectId') ?? undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, BudgetPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ policy: await createBudgetPolicy(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
