import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { LimitationDisclosureSurface } from '@/db/schema'
import { listLimitationAcknowledgements } from '@/server/known-limitation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      acknowledgements: await listLimitationAcknowledgements({
        limitationId: req.nextUrl.searchParams.get('limitationId') ?? undefined,
        acknowledgedBy: req.nextUrl.searchParams.get('acknowledgedBy') ?? undefined,
        surface: (req.nextUrl.searchParams.get('surface') ?? undefined) as
          | LimitationDisclosureSurface
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
