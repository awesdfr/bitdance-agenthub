import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AcceptanceCriteriaRunBody } from '@/server/control-plane-validators'
import { runFinalAcceptanceSuite } from '@/server/acceptance-test-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, AcceptanceCriteriaRunBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(await runFinalAcceptanceSuite(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
