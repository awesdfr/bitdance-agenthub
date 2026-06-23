import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { TaskBatchApplyBody } from '@/server/control-plane-validators'
import { applyTaskBatch } from '@/server/task-batching-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, TaskBatchApplyBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ taskBatch: await applyTaskBatch(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}
