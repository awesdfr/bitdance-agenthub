import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ModelConnectionTestBody } from '@/server/control-plane-validators'
import { testModelConnection } from '@/server/model-gateway-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, ModelConnectionTestBody)
  if (!parsed.ok) return parsed.response
  try {
    const modelConnectionTest = await testModelConnection({
      modelProfileId: await getRouteId(ctx),
      live: parsed.data.live,
      confirmExternalCall: parsed.data.confirmExternalCall,
    })
    return NextResponse.json({ modelConnectionTest }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
