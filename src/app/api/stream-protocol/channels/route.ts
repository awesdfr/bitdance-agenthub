import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { OpenSourceGovernanceStatus } from '@/db/schema'
import { StreamProtocolChannelBody } from '@/server/control-plane-validators'
import {
  createStreamProtocolChannel,
  listStreamProtocolChannels,
} from '@/server/streaming-protocol-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    streamProtocolChannels: await listStreamProtocolChannels({
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, StreamProtocolChannelBody)
  if (!parsed.ok) return parsed.response
  try {
    const channel = await createStreamProtocolChannel(parsed.data)
    return NextResponse.json({ channel }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
