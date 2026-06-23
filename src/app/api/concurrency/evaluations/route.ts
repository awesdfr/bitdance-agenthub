import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ConcurrencyEvaluationStatus } from '@/db/schema'
import { ConcurrencyEvaluationBody } from '@/server/control-plane-validators'
import {
  evaluateConcurrency,
  listConcurrencyEvaluations,
} from '@/server/concurrency-model-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    concurrencyEvaluations: await listConcurrencyEvaluations({
      concurrencyProfileId: req.nextUrl.searchParams.get('concurrencyProfileId') ?? undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | ConcurrencyEvaluationStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ConcurrencyEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    const concurrencyEvaluation = await evaluateConcurrency(parsed.data)
    return NextResponse.json({ concurrencyEvaluation }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
