import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TaskQueueBody } from '@/server/control-plane-validators'
import { createTaskQueue, listTaskQueues } from '@/server/scheduler-service'

export async function GET() {
  return NextResponse.json({ taskQueues: await listTaskQueues() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, TaskQueueBody)
  if (!parsed.ok) return parsed.response
  try {
    const taskQueue = await createTaskQueue(parsed.data)
    return NextResponse.json({ taskQueue }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
