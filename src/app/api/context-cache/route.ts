import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import {
  ContextCacheStatusSchema,
  ContextPreloadTaskTypeSchema,
} from '@/server/control-plane-validators'
import { listContextCaches } from '@/server/context-preloader-service'

export async function GET(req: NextRequest) {
  try {
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const projectId = req.nextUrl.searchParams.get('projectId') ?? undefined
    const taskTypeParam = req.nextUrl.searchParams.get('taskType') ?? undefined
    const statusParam = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      caches: await listContextCaches({
        agentProfileId,
        projectId,
        taskType: taskTypeParam ? ContextPreloadTaskTypeSchema.parse(taskTypeParam) : undefined,
        status: statusParam ? ContextCacheStatusSchema.parse(statusParam) : undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
