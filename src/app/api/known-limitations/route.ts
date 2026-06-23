import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type {
  KnownLimitationCategory,
  KnownLimitationSeverity,
  KnownLimitationStatus,
  LimitationDisclosureSurface,
} from '@/db/schema'
import { listKnownLimitations } from '@/server/known-limitation-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      limitations: await listKnownLimitations({
        category: (req.nextUrl.searchParams.get('category') ?? undefined) as
          | KnownLimitationCategory
          | undefined,
        severity: (req.nextUrl.searchParams.get('severity') ?? undefined) as
          | KnownLimitationSeverity
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | KnownLimitationStatus
          | undefined,
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
