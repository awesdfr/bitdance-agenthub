import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listOSInterferencePolicies } from '@/server/os-interference-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      policies: await listOSInterferencePolicies({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | 'active'
          | 'disabled'
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 25),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
