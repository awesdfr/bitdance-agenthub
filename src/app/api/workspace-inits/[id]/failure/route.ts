import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { WorkspaceInitFailureBody } from '@/server/control-plane-validators'
import { resolveWorkspaceInitFailure } from '@/server/workspace-init-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, WorkspaceInitFailureBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      result: await resolveWorkspaceInitFailure({
        workspaceInitRunId: await getRouteId(ctx),
        ...parsed.data,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
