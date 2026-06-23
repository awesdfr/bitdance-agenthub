import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AbuseAppealStatus } from '@/db/schema'
import { AbuseAppealBody } from '@/server/control-plane-validators'
import {
  listAbuseAppeals,
  submitAbuseAppeal,
} from '@/server/abuse-prevention-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    abuseAppeals: await listAbuseAppeals({
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | AbuseAppealStatus
        | undefined,
      agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AbuseAppealBody)
  if (!parsed.ok) return parsed.response
  try {
    const abuseAppeal = await submitAbuseAppeal(parsed.data)
    return NextResponse.json({ abuseAppeal }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
