import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SimulationRunBody } from '@/server/control-plane-validators'
import { createSimulationRun, listSimulationRuns } from '@/server/simulation-backtest-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      simulationRuns: await listSimulationRuns({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        workflowId: req.nextUrl.searchParams.get('workflowId') ?? undefined,
        status: parseStatus(req.nextUrl.searchParams.get('status')),
        limit: parseLimit(req.nextUrl.searchParams.get('limit')),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, SimulationRunBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { simulationRun: await createSimulationRun(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}

function parseStatus(value: string | null) {
  if (value === 'awaiting_review' || value === 'approved' || value === 'rejected') return value
  return undefined
}

function parseLimit(value: string | null): number | undefined {
  return value ? Number(value) : undefined
}
