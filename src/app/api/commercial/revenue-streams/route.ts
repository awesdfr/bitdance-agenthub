import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { RevenueStreamStatus, RevenueStreamType } from '@/db/schema'
import { RevenueStreamBody } from '@/server/control-plane-validators'
import {
  createRevenueStream,
  listRevenueStreams,
} from '@/server/pricing-strategy-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    revenueStreams: await listRevenueStreams({
      streamType: (req.nextUrl.searchParams.get('streamType') ?? undefined) as
        | RevenueStreamType
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | RevenueStreamStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, RevenueStreamBody)
  if (!parsed.ok) return parsed.response
  try {
    const revenueStream = await createRevenueStream(parsed.data)
    return NextResponse.json({ revenueStream }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
