import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { OpenSourceGovernanceStatus } from '@/db/schema'
import { PromptAntiPatternRuleBody } from '@/server/control-plane-validators'
import {
  createPromptAntiPatternRule,
  listPromptAntiPatternRules,
} from '@/server/prompt-engineering-guide-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    rules: await listPromptAntiPatternRules({
      guideId: req.nextUrl.searchParams.get('guideId') ?? undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, PromptAntiPatternRuleBody)
  if (!parsed.ok) return parsed.response
  try {
    const rule = await createPromptAntiPatternRule(parsed.data)
    return NextResponse.json({ rule }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
