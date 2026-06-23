import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { StreamProtocolEventBody } from '@/server/control-plane-validators'
import {
  listStreamProtocolEvents,
  publishStreamProtocolEvent,
} from '@/server/streaming-protocol-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    streamProtocolEvents: await listStreamProtocolEvents({
      stream: req.nextUrl.searchParams.get('stream') ?? undefined,
      afterSequence: req.nextUrl.searchParams.get('afterSequence')
        ? Number(req.nextUrl.searchParams.get('afterSequence'))
        : undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, StreamProtocolEventBody)
  if (!parsed.ok) return parsed.response
  try {
    const event = await publishStreamProtocolEvent(parsed.data)
    return NextResponse.json({ event }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
