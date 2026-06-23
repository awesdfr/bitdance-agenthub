import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { BacktestRunBody } from '@/server/control-plane-validators'
import { listBacktestRuns, runBacktest } from '@/server/simulation-backtest-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      backtestRuns: await listBacktestRuns({
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        workflowId: req.nextUrl.searchParams.get('workflowId') ?? undefined,
        goldenTaskSetId: req.nextUrl.searchParams.get('goldenTaskSetId') ?? undefined,
        gateStatus: parseGateStatus(req.nextUrl.searchParams.get('gateStatus')),
        limit: parseLimit(req.nextUrl.searchParams.get('limit')),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, BacktestRunBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { backtestRun: await runBacktest(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}

function parseGateStatus(value: string | null) {
  if (value === 'passed' || value === 'warning' || value === 'failed') return value
  return undefined
}

function parseLimit(value: string | null): number | undefined {
  return value ? Number(value) : undefined
}
