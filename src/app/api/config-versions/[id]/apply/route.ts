import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ConfigVersionApplyBody } from '@/server/control-plane-validators'
import { applyConfigVersion } from '@/server/config-version-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, ConfigVersionApplyBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await applyConfigVersion(await getRouteId(ctx), parsed.data))
  } catch (err) {
    return errorResponse(err)
  }
}
