import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { OpenSourceGovernanceStatus } from '@/db/schema'
import { PromptEngineeringGuideBody } from '@/server/control-plane-validators'
import {
  createPromptEngineeringGuide,
  listPromptEngineeringGuides,
} from '@/server/prompt-engineering-guide-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    guides: await listPromptEngineeringGuides({
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, PromptEngineeringGuideBody)
  if (!parsed.ok) return parsed.response
  try {
    const guide = await createPromptEngineeringGuide(parsed.data)
    return NextResponse.json({ guide }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
