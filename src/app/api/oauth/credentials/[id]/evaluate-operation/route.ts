import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { OAuthOperationEvaluationBody } from '@/server/control-plane-validators'
import { evaluateOAuthOperation } from '@/server/oauth-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, OAuthOperationEvaluationBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      evaluation: await evaluateOAuthOperation({
        credentialId: await getRouteId(ctx),
        ...parsed.data,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
