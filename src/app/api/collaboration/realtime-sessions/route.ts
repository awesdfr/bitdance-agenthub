import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RealtimeCollabSessionBody } from '@/server/control-plane-validators'
import {
  createRealtimeCollabSession,
  listRealtimeCollabSessions,
} from '@/server/collaboration-service'

export async function GET() {
  return NextResponse.json({ realtimeCollabSessions: await listRealtimeCollabSessions() })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, RealtimeCollabSessionBody)
    if (!parsed.ok) return parsed.response
    const realtimeCollabSession = await createRealtimeCollabSession(parsed.data)
    return NextResponse.json({ realtimeCollabSession }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
