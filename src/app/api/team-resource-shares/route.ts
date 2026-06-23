import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { TeamResourceSharingPolicy, TeamResourceType } from '@/db/schema'
import { TeamResourceShareBody } from '@/server/control-plane-validators'
import { listTeamResourceShares, shareTeamResource } from '@/server/team-collaboration-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      teamResourceShares: await listTeamResourceShares({
        teamId: req.nextUrl.searchParams.get('teamId') ?? undefined,
        resourceType: (req.nextUrl.searchParams.get('resourceType') ?? undefined) as
          | TeamResourceType
          | undefined,
        resourceId: req.nextUrl.searchParams.get('resourceId') ?? undefined,
        sharingPolicy: (req.nextUrl.searchParams.get('sharingPolicy') ?? undefined) as
          | TeamResourceSharingPolicy
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
    const parsed = await parseJsonBody(req, TeamResourceShareBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ teamResourceShare: await shareTeamResource(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
