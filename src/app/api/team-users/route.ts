import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { TeamUserRoleSystem, TeamUserStatus } from '@/db/schema'
import { TeamUserBody } from '@/server/control-plane-validators'
import { createTeamUser, listTeamUsers } from '@/server/team-collaboration-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      teamUsers: await listTeamUsers({
        roleSystem: (req.nextUrl.searchParams.get('roleSystem') ?? undefined) as
          | TeamUserRoleSystem
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as TeamUserStatus | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, TeamUserBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ teamUser: await createTeamUser(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
