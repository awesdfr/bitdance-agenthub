import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TaskTemplateRunCompleteBody } from '@/server/control-plane-validators'
import { completeTaskTemplateRun } from '@/server/task-template-service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const parsed = await parseJsonBody(req, TaskTemplateRunCompleteBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ taskTemplateRun: await completeTaskTemplateRun(id, parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
