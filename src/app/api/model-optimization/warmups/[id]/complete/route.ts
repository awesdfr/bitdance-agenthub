import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ModelWarmupCompleteBody } from '@/server/control-plane-validators'
import { completeModelWarmup } from '@/server/model-invocation-optimization-service'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, ModelWarmupCompleteBody)
  if (!parsed.ok) return parsed.response
  try {
    const { id } = await context.params
    return NextResponse.json({ warmup: await completeModelWarmup(id, parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
