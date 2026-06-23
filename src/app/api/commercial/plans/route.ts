import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { CommercialPlanKey, CommercialPlanStatus } from '@/db/schema'
import { CommercialPlanBody } from '@/server/control-plane-validators'
import {
  createCommercialPlan,
  listCommercialPlans,
} from '@/server/pricing-strategy-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    commercialPlans: await listCommercialPlans({
      planKey: (req.nextUrl.searchParams.get('planKey') ?? undefined) as
        | CommercialPlanKey
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | CommercialPlanStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, CommercialPlanBody)
  if (!parsed.ok) return parsed.response
  try {
    const commercialPlan = await createCommercialPlan(parsed.data)
    return NextResponse.json({ commercialPlan }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
