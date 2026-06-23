import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ModelRoutePreviewBody } from '@/server/control-plane-validators'
import { previewModelRoute } from '@/server/model-gateway-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ModelRoutePreviewBody)
  if (!parsed.ok) return parsed.response
  try {
    const modelRouteDecision = await previewModelRoute(parsed.data)
    return NextResponse.json({ modelRouteDecision }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
