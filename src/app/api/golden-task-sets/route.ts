import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { GoldenTaskSetBody } from '@/server/control-plane-validators'
import { createGoldenTaskSet, listGoldenTaskSets } from '@/server/simulation-backtest-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      goldenTaskSets: await listGoldenTaskSets({
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
    const parsed = await parseJsonBody(req, GoldenTaskSetBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { goldenTaskSet: await createGoldenTaskSet(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}

function parseStatus(value: string | null) {
  if (value === 'active' || value === 'draft' || value === 'archived') return value
  return undefined
}

function parseLimit(value: string | null): number | undefined {
  return value ? Number(value) : undefined
}
