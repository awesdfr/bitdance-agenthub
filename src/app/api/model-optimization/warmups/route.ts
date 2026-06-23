import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ModelWarmupStatus } from '@/db/schema'
import { ModelWarmupStartBody } from '@/server/control-plane-validators'
import {
  listModelWarmupSessions,
  startModelWarmup,
} from '@/server/model-invocation-optimization-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      warmups: await listModelWarmupSessions({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | ModelWarmupStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ModelWarmupStartBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ warmup: await startModelWarmup(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
