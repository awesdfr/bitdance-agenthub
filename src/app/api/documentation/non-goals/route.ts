import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { NonGoalScopeSchema } from '@/server/control-plane-validators'
import { listNonGoalPolicies } from '@/server/non-goal-policy-service'

export async function GET(req: NextRequest) {
  try {
    const scopeParam = req.nextUrl.searchParams.get('scope') ?? undefined
    const scope = scopeParam ? NonGoalScopeSchema.parse(scopeParam) : undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      policies: await listNonGoalPolicies({
        scope,
        status,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
