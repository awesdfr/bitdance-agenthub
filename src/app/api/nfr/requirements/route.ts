import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { NfrCategory, NfrRequirementStatus } from '@/db/schema'
import { listNfrRequirements } from '@/server/nfr-requirement-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      requirements: await listNfrRequirements({
        category: (req.nextUrl.searchParams.get('category') ?? undefined) as
          | NfrCategory
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | NfrRequirementStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
