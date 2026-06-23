import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ProjectSwitchStatus } from '@/db/schema'
import { ProjectSwitchBody } from '@/server/control-plane-validators'
import {
  listProjectSwitchEvents,
  planProjectSwitch,
} from '@/server/project-context-service'

export async function GET(req: NextRequest) {
  try {
    const agentId = req.nextUrl.searchParams.get('agentId') ?? undefined
    const toProjectContextId = req.nextUrl.searchParams.get('toProjectContextId') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      switchEvents: await listProjectSwitchEvents({
        agentId,
        toProjectContextId,
        status: status as ProjectSwitchStatus | undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ProjectSwitchBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { switchEvent: await planProjectSwitch(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
