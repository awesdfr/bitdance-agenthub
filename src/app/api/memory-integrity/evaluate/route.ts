import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MemoryBeforeWriteEvaluationBody } from '@/server/control-plane-validators'
import { evaluateMemoryBeforeWrite } from '@/server/memory-integrity-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, MemoryBeforeWriteEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      evaluation: await evaluateMemoryBeforeWrite(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
