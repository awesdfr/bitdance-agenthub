import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ModelCapabilityProbeBody } from '@/server/control-plane-validators'
import { runModelCapabilityProbe } from '@/server/model-gateway-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, ModelCapabilityProbeBody)
  if (!parsed.ok) return parsed.response
  try {
    const modelConnectionTest = await runModelCapabilityProbe({
      modelProfileId: await getRouteId(ctx),
      kind: parsed.data.kind,
      live: parsed.data.live,
      confirmExternalCall: parsed.data.confirmExternalCall,
      stream: parsed.data.stream,
      prompt: parsed.data.prompt,
      visionImageDataUrl: parsed.data.visionImageDataUrl,
    })
    return NextResponse.json({ modelConnectionTest }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
