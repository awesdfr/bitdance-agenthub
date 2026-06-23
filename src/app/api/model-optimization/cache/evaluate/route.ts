import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ModelResponseCacheEvaluationBody } from '@/server/control-plane-validators'
import { evaluateModelResponseCache } from '@/server/model-invocation-optimization-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ModelResponseCacheEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ result: await evaluateModelResponseCache(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
