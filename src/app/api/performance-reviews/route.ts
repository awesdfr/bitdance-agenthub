import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { PerformanceReviewBody } from '@/server/control-plane-validators'
import {
  createPerformanceReview,
  listPerformanceReviews,
} from '@/server/agent-interview-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return NextResponse.json({
    performanceReviews: await listPerformanceReviews({
      agentProfileId: searchParams.get('agentProfileId'),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, PerformanceReviewBody)
  if (!parsed.ok) return parsed.response
  try {
    const performanceReview = await createPerformanceReview(parsed.data)
    return NextResponse.json({ performanceReview }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
