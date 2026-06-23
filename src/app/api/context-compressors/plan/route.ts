import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ContextCompressionPlanBody } from '@/server/control-plane-validators'
import { planContextCompression } from '@/server/prompt-context-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ContextCompressionPlanBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { plan: await planContextCompression(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
