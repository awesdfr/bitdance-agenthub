import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { WorkspaceInitRunStatus, WorkspaceInitSourceType } from '@/db/schema'
import { WorkspaceInitBody } from '@/server/control-plane-validators'
import { listWorkspaceInitRuns, planWorkspaceInit } from '@/server/workspace-init-service'

export async function GET(req: NextRequest) {
  try {
    const sourceType = req.nextUrl.searchParams.get('sourceType') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      runs: await listWorkspaceInitRuns({
        sourceType: sourceType as WorkspaceInitSourceType | undefined,
        status: status as WorkspaceInitRunStatus | undefined,
        agentProfileId,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, WorkspaceInitBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ run: await planWorkspaceInit(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
