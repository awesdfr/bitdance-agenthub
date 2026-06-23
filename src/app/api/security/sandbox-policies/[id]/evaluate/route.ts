import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { SandboxAccessBody } from '@/server/control-plane-validators'
import { evaluateSandboxAccess } from '@/server/security-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, SandboxAccessBody)
  if (!parsed.ok) return parsed.response
  try {
    const decision = await evaluateSandboxAccess({
      sandboxPolicyId: await getRouteId(ctx),
      ...parsed.data,
    })
    return NextResponse.json({ decision })
  } catch (err) {
    return errorResponse(err)
  }
}
