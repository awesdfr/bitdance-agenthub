import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ProjectContextStatus } from '@/db/schema'
import { ProjectContextBody } from '@/server/control-plane-validators'
import { createProjectContext, listProjectContexts } from '@/server/project-context-service'

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      projectContexts: await listProjectContexts({
        status: status as ProjectContextStatus | undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ProjectContextBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { projectContext: await createProjectContext(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
