import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RecoveryEventBody } from '@/server/control-plane-validators'
import { listRecoveryEvents, recordRecoveryEvent } from '@/server/recovery-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    recoveryEvents: await listRecoveryEvents({
      resourceType: req.nextUrl.searchParams.get('resourceType') ?? undefined,
      resourceId: req.nextUrl.searchParams.get('resourceId') ?? undefined,
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, RecoveryEventBody)
  if (!parsed.ok) return parsed.response
  try {
    const recoveryEvent = await recordRecoveryEvent(parsed.data)
    return NextResponse.json({ recoveryEvent }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
