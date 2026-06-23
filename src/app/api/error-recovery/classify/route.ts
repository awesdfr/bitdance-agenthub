import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ErrorClassificationBody } from '@/server/control-plane-validators'
import { classifyRuntimeError } from '@/server/error-recovery-strategy-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ErrorClassificationBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { errorClassification: await classifyRuntimeError(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
