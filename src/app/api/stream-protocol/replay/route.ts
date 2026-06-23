import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { StreamReplayCursorBody } from '@/server/control-plane-validators'
import { replayStreamEvents } from '@/server/streaming-protocol-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, StreamReplayCursorBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await replayStreamEvents(parsed.data))
  } catch (err) {
    return errorResponse(err)
  }
}
