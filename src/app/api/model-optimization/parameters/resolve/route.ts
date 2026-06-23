import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ModelParametersResolveBody } from '@/server/control-plane-validators'
import { resolveModelParameters } from '@/server/model-invocation-optimization-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ModelParametersResolveBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ result: await resolveModelParameters(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
