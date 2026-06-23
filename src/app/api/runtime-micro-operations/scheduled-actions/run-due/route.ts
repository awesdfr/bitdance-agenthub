import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RunDueScheduledActionsBody } from '@/server/control-plane-validators'
import { runDueScheduledActions } from '@/server/runtime-micro-operation-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, RunDueScheduledActionsBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ result: await runDueScheduledActions(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
