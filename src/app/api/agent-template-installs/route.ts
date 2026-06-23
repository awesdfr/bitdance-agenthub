import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { AgentTemplatePackageType } from '@/db/schema'
import { listAgentTemplateInstalls } from '@/server/agent-template-marketplace-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      agentTemplateInstalls: await listAgentTemplateInstalls({
        templateId: req.nextUrl.searchParams.get('templateId') ?? undefined,
        installedByUserId: req.nextUrl.searchParams.get('installedByUserId') ?? undefined,
        targetType: (req.nextUrl.searchParams.get('targetType') ?? undefined) as
          | AgentTemplatePackageType
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
