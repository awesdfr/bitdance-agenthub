import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { TakeoverSessionBody } from '@/server/control-plane-validators'
import {
  listTakeoverSessions,
  startTakeoverSession,
} from '@/server/human-collaboration-service'

export async function GET(req: NextRequest) {
  try {
    const runId = req.nextUrl.searchParams.get('runId') ?? undefined
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const status = req.nextUrl.searchParams.get('status') as
      | 'active'
      | 'completed'
      | 'cancelled'
      | null
    const resource = req.nextUrl.searchParams.get('resource') as
      | 'browser'
      | 'desktop'
      | 'cli'
      | 'file_editor'
      | null
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      sessions: await listTakeoverSessions({
        runId,
        agentProfileId,
        status: status ?? undefined,
        resource: resource ?? undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, TakeoverSessionBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { session: await startTakeoverSession(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
