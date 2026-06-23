import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listTaskTemplateRuns } from '@/server/task-template-service'

export async function GET(req: NextRequest) {
  try {
    const taskTemplateId = req.nextUrl.searchParams.get('taskTemplateId') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      taskTemplateRuns: await listTaskTemplateRuns({
        taskTemplateId,
        status:
          status === 'planned' || status === 'queued' || status === 'completed' || status === 'failed'
            ? status
            : undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
