import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { getAgentMemoryLearningReport } from '@/server/agent-memory-learning-report-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const report = await getAgentMemoryLearningReport(await getRouteId(ctx), {
      goal: req.nextUrl.searchParams.get('q') ?? undefined,
    })
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err)
  }
}
