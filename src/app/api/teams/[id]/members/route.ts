import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import type { TeamMembershipStatus } from '@/db/schema'
import { TeamMembershipBody } from '@/server/control-plane-validators'
import { addTeamMember, listTeamMemberships } from '@/server/team-collaboration-service'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const teamId = await getRouteId(ctx)
    return NextResponse.json({
      teamMemberships: await listTeamMemberships({
        teamId,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | TeamMembershipStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseJsonBody(req, TeamMembershipBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      teamMembership: await addTeamMember({
        teamId: await getRouteId(ctx),
        ...parsed.data,
      }),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
