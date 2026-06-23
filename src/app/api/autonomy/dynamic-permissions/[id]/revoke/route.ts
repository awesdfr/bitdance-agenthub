import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { DynamicPermissionRevokeBody } from '@/server/control-plane-validators'
import { revokeDynamicPermissionGrant } from '@/server/dynamic-permission-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, DynamicPermissionRevokeBody)
  if (!parsed.ok) return parsed.response
  try {
    const dynamicPermissionGrant = await revokeDynamicPermissionGrant(
      await getRouteId(ctx),
      parsed.data.reason,
    )
    return NextResponse.json({ dynamicPermissionGrant })
  } catch (err) {
    return errorResponse(err)
  }
}
