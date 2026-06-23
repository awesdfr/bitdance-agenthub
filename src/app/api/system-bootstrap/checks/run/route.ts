import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SystemBootstrapCheckRunBody } from '@/server/control-plane-validators'
import { runSystemBootstrapChecks } from '@/server/system-bootstrap-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SystemBootstrapCheckRunBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { checks: await runSystemBootstrapChecks(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
