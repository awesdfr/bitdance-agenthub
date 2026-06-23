import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { HumanApprovalPolicyBody } from '@/server/control-plane-validators'
import {
  createHumanApprovalPolicy,
  listHumanApprovalPolicies,
} from '@/server/human-collaboration-service'

export async function GET(req: NextRequest) {
  try {
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const workflowId = req.nextUrl.searchParams.get('workflowId') ?? undefined
    const status = req.nextUrl.searchParams.get('status') as 'active' | 'disabled' | null
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      policies: await listHumanApprovalPolicies({
        agentProfileId,
        workflowId,
        status: status ?? undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, HumanApprovalPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { policy: await createHumanApprovalPolicy(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
