import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { OAuthReauthorizationBody } from '@/server/control-plane-validators'
import { completeOAuthReauthorization } from '@/server/oauth-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, OAuthReauthorizationBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      result: await completeOAuthReauthorization({
        credentialId: await getRouteId(ctx),
        ...parsed.data,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
