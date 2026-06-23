import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { AgentTemplateInstallBody } from '@/server/control-plane-validators'
import { installAgentTemplatePackage } from '@/server/agent-template-marketplace-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseJsonBody(req, AgentTemplateInstallBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(await installAgentTemplatePackage(await getRouteId(ctx), parsed.data), {
      status: 201,
    })
  } catch (err) {
    return errorResponse(err)
  }
}
