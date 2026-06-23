import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { HumanApprovalPolicyEvaluationBody } from '@/server/control-plane-validators'
import { evaluateHumanApprovalPolicy } from '@/server/human-collaboration-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, HumanApprovalPolicyEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      evaluation: await evaluateHumanApprovalPolicy({
        policyId: await getRouteId(ctx),
        ...parsed.data,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
