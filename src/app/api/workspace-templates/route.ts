import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { WorkspaceStructure } from '@/db/schema'
import { WorkspaceStructureSchema, WorkspaceTemplateBody } from '@/server/control-plane-validators'
import { createWorkspaceTemplate, listWorkspaceTemplates } from '@/server/workspace-init-service'

export async function GET(req: NextRequest) {
  try {
    const structureParam = req.nextUrl.searchParams.get('structure') ?? undefined
    const structure = structureParam ? WorkspaceStructureSchema.parse(structureParam) : undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      templates: await listWorkspaceTemplates({
        structure: structure as WorkspaceStructure | undefined,
        status,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, WorkspaceTemplateBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { template: await createWorkspaceTemplate(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
