import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TaskTemplateInstantiateBody } from '@/server/control-plane-validators'
import { instantiateTaskTemplate } from '@/server/task-template-service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const parsed = await parseJsonBody(req, TaskTemplateInstantiateBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { taskTemplateRun: await instantiateTaskTemplate(id, parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
