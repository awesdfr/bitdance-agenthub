import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listContextCompressionPlans } from '@/server/prompt-context-service'

export async function GET(req: NextRequest) {
  try {
    const policyId = req.nextUrl.searchParams.get('policyId') ?? undefined
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const status = req.nextUrl.searchParams.get('status') as
      | 'not_needed'
      | 'planned'
      | 'compressed'
      | null
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      plans: await listContextCompressionPlans({
        policyId,
        agentProfileId,
        status: status ?? undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
