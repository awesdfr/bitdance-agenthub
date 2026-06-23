import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { OAuthRefreshStatus } from '@/db/schema'
import { listOAuthRefreshEvents } from '@/server/oauth-service'

export async function GET(req: NextRequest) {
  try {
    const credentialId = req.nextUrl.searchParams.get('credentialId') ?? undefined
    const status = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      events: await listOAuthRefreshEvents({
        credentialId,
        status: status as OAuthRefreshStatus | undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
