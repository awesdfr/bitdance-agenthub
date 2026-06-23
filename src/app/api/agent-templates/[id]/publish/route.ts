import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { publishAgentTemplatePackage } from '@/server/agent-template-marketplace-service'

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({ agentTemplate: await publishAgentTemplatePackage(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}
