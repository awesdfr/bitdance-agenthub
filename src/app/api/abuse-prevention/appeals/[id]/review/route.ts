import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AbuseAppealReviewBody } from '@/server/control-plane-validators'
import { reviewAbuseAppeal } from '@/server/abuse-prevention-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, context: RouteContext) {
  const parsed = await parseJsonBody(req, AbuseAppealReviewBody)
  if (!parsed.ok) return parsed.response
  try {
    const { id } = await context.params
    const abuseAppeal = await reviewAbuseAppeal(
      id,
      parsed.data.approved,
      parsed.data.reviewNote,
    )
    return NextResponse.json({ abuseAppeal })
  } catch (err) {
    return errorResponse(err)
  }
}
