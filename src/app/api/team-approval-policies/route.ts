import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { TeamApprovalMode, TeamApprovalPolicyStatus } from '@/db/schema'
import { TeamApprovalPolicyBody } from '@/server/control-plane-validators'
import {
  createTeamApprovalPolicy,
  listTeamApprovalPolicies,
} from '@/server/team-collaboration-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      teamApprovalPolicies: await listTeamApprovalPolicies({
        teamId: req.nextUrl.searchParams.get('teamId') ?? undefined,
        approvalMode: (req.nextUrl.searchParams.get('approvalMode') ?? undefined) as
          | TeamApprovalMode
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | TeamApprovalPolicyStatus
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
    const parsed = await parseJsonBody(req, TeamApprovalPolicyBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      teamApprovalPolicy: await createTeamApprovalPolicy(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
