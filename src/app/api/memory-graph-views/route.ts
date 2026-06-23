import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MemoryGraphViewBody } from '@/server/control-plane-validators'
import { createMemoryGraphView, listMemoryGraphViews } from '@/server/memory-graph-service'

export async function GET(req: NextRequest) {
  try {
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const focusAgentProfileId = req.nextUrl.searchParams.get('focusAgentProfileId') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      views: await listMemoryGraphViews({
        agentProfileId,
        focusAgentProfileId,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, MemoryGraphViewBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ view: await createMemoryGraphView(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
