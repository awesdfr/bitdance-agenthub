import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ScheduledActionStatus } from '@/db/schema'
import { ScheduledActionBody } from '@/server/control-plane-validators'
import {
  createScheduledAction,
  listScheduledActions,
} from '@/server/runtime-micro-operation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      scheduledActions: await listScheduledActions({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | ScheduledActionStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ScheduledActionBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ scheduledAction: await createScheduledAction(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
