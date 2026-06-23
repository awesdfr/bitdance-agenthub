import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { TeamStatus } from '@/db/schema'
import { TeamBody } from '@/server/control-plane-validators'
import { createTeam, listTeams } from '@/server/team-collaboration-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      teams: await listTeams({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as TeamStatus | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, TeamBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ team: await createTeam(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
