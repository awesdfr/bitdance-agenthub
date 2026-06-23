import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TaskScheduleBody } from '@/server/control-plane-validators'
import {
  createTaskSchedule,
  listTaskSchedules,
} from '@/server/scheduler-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return NextResponse.json({
    taskSchedules: await listTaskSchedules(searchParams.get('queueId') ?? undefined),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, TaskScheduleBody)
    if (!parsed.ok) return parsed.response
    const taskSchedule = await createTaskSchedule(parsed.data)
    return NextResponse.json({ taskSchedule }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
