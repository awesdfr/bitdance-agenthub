import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ProjectAgentRoleBody } from '@/server/control-plane-validators'
import {
  addProjectAgentRole,
  listProjectAgentRoles,
} from '@/server/project-context-service'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    return NextResponse.json({
      agentRoles: await listProjectAgentRoles({
        projectContextId: await getRouteId(ctx),
        status,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, ProjectAgentRoleBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      {
        agentRole: await addProjectAgentRole({
          projectContextId: await getRouteId(ctx),
          ...parsed.data,
        }),
      },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
