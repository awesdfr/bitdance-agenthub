import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { CommercialPlanStatus, CommercialPolicyRuleType } from '@/db/schema'
import { CommercialPolicyRuleBody } from '@/server/control-plane-validators'
import {
  createCommercialPolicyRule,
  listCommercialPolicyRules,
} from '@/server/pricing-strategy-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    commercialPolicyRules: await listCommercialPolicyRules({
      ruleType: (req.nextUrl.searchParams.get('ruleType') ?? undefined) as
        | CommercialPolicyRuleType
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | CommercialPlanStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, CommercialPolicyRuleBody)
  if (!parsed.ok) return parsed.response
  try {
    const commercialPolicyRule = await createCommercialPolicyRule(parsed.data)
    return NextResponse.json({ commercialPolicyRule }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
