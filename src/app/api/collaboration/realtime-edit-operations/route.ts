import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RealtimeEditOperationBody } from '@/server/control-plane-validators'
import {
  applyRealtimeEditOperation,
  listRealtimeEditOperations,
} from '@/server/collaboration-service'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? undefined
  return NextResponse.json({ realtimeEditOperations: await listRealtimeEditOperations(sessionId) })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, RealtimeEditOperationBody)
    if (!parsed.ok) return parsed.response
    const realtimeEditOperation = await applyRealtimeEditOperation(parsed.data)
    return NextResponse.json({ realtimeEditOperation }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
