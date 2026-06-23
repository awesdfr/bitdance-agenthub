import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentContextPreviewBody } from '@/server/control-plane-validators'
import { previewAgentContextPack } from '@/server/prompt-context-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, AgentContextPreviewBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      await previewAgentContextPack({
        agentProfileId: await getRouteId(ctx),
        goal: parsed.data.goal,
        input: parsed.data.input,
        tokenBudget: parsed.data.tokenBudget,
        memoryLimit: parsed.data.memoryLimit,
      }),
    )
  } catch (err) {
    return errorResponse(err)
  }
}
