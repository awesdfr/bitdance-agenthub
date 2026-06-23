import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type {
  AgentTemplateCategory,
  AgentTemplatePackageType,
  AgentTemplateSource,
  AgentTemplateStatus,
  AgentTemplateVisibility,
} from '@/db/schema'
import { AgentTemplatePackageBody } from '@/server/control-plane-validators'
import {
  createAgentTemplatePackage,
  listAgentTemplatePackages,
} from '@/server/agent-template-marketplace-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      agentTemplates: await listAgentTemplatePackages({
        templateType: (req.nextUrl.searchParams.get('templateType') ?? undefined) as
          | AgentTemplatePackageType
          | undefined,
        category: (req.nextUrl.searchParams.get('category') ?? undefined) as
          | AgentTemplateCategory
          | undefined,
        source: (req.nextUrl.searchParams.get('source') ?? undefined) as AgentTemplateSource | undefined,
        visibility: (req.nextUrl.searchParams.get('visibility') ?? undefined) as
          | AgentTemplateVisibility
          | undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as AgentTemplateStatus | undefined,
        query: req.nextUrl.searchParams.get('query') ?? undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, AgentTemplatePackageBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({
      agentTemplate: await createAgentTemplatePackage(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
