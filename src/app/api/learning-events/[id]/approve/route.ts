import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { LearningReviewBody } from '@/server/control-plane-validators'
import { approveLearningEvent } from '@/server/learning-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, LearningReviewBody)
  if (!parsed.ok) return parsed.response
  try {
    const result = await approveLearningEvent(await getRouteId(ctx), parsed.data.reviewerNote ?? '')
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err)
  }
}
