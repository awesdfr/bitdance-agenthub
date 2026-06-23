import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TaskTemplateBody } from '@/server/control-plane-validators'
import { createTaskTemplate, listTaskTemplates } from '@/server/task-template-service'

export async function GET(req: NextRequest) {
  try {
    const category = req.nextUrl.searchParams.get('category') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const query = req.nextUrl.searchParams.get('query') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      taskTemplates: await listTaskTemplates({
        category,
        status: status === 'active' || status === 'archived' ? status : undefined,
        query,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, TaskTemplateBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { taskTemplate: await createTaskTemplate(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
