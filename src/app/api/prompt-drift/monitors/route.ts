import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type {
  PromptDriftMonitorStatus,
  PromptDriftSchedule,
} from '@/db/schema'
import { PromptDriftMonitorBody } from '@/server/control-plane-validators'
import {
  createPromptDriftMonitor,
  listPromptDriftMonitors,
} from '@/server/prompt-drift-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      monitors: await listPromptDriftMonitors({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        modelProfileId: req.nextUrl.searchParams.get('modelProfileId') ?? undefined,
        schedule: (req.nextUrl.searchParams.get('schedule') ?? undefined) as
          | PromptDriftSchedule
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | PromptDriftMonitorStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, PromptDriftMonitorBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ monitor: await createPromptDriftMonitor(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
