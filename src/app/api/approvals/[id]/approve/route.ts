import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { respondApprovalRequest } from '@/server/control-plane-service'
import { ApprovalResponseBody } from '@/server/control-plane-validators'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, ApprovalResponseBody)
  if (!parsed.ok) return parsed.response
  try {
    const approvalRequest = await respondApprovalRequest(
      await getRouteId(ctx),
      true,
      parsed.data.response,
    )
    return NextResponse.json({ approvalRequest })
  } catch (err) {
    return errorResponse(err)
  }
}
