import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TeamPermissionEvaluationBody } from '@/server/control-plane-validators'
import { evaluateTeamPermission } from '@/server/team-collaboration-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, TeamPermissionEvaluationBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ evaluation: await evaluateTeamPermission(parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
