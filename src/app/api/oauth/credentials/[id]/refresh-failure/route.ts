import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { OAuthRefreshFailureBody } from '@/server/control-plane-validators'
import { recordOAuthRefreshFailure } from '@/server/oauth-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, OAuthRefreshFailureBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      result: await recordOAuthRefreshFailure({
        credentialId: await getRouteId(ctx),
        ...parsed.data,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
