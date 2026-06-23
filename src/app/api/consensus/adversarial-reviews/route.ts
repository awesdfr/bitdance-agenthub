import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AdversarialReviewStatus } from '@/db/schema'
import { AdversarialReviewBody } from '@/server/control-plane-validators'
import {
  createAdversarialReview,
  listAdversarialReviews,
} from '@/server/consensus-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      reviews: await listAdversarialReviews({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | AdversarialReviewStatus
          | undefined,
        subjectAgentId: req.nextUrl.searchParams.get('subjectAgentId') ?? undefined,
        reviewerAgentId: req.nextUrl.searchParams.get('reviewerAgentId') ?? undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AdversarialReviewBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ review: await createAdversarialReview(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
