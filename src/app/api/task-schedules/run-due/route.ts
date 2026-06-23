import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RunDueTaskSchedulesBody } from '@/server/control-plane-validators'
import { runDueTaskSchedules } from '@/server/scheduler-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, RunDueTaskSchedulesBody)
    if (!parsed.ok) return parsed.response
    const result = await runDueTaskSchedules(parsed.data)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
