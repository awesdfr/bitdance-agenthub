import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { TaskBatchStatus } from '@/db/schema'
import { TaskBatchPlanBody } from '@/server/control-plane-validators'
import { listTaskBatches, planTaskBatch } from '@/server/task-batching-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      taskBatches: await listTaskBatches({
        queueId: req.nextUrl.searchParams.get('queueId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as TaskBatchStatus | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, TaskBatchPlanBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ taskBatch: await planTaskBatch(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
