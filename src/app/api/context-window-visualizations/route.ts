import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ContextWindowVisualizationBody } from '@/server/control-plane-validators'
import {
  createContextWindowVisualization,
  listContextWindowVisualizations,
} from '@/server/context-window-visualizer-service'

export async function GET(req: NextRequest) {
  try {
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const employeeRunId = req.nextUrl.searchParams.get('employeeRunId') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      visualizations: await listContextWindowVisualizations({
        agentProfileId,
        employeeRunId,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ContextWindowVisualizationBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { visualization: await createContextWindowVisualization(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
