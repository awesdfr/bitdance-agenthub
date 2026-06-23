import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { CicdTriggerBody } from '@/server/control-plane-validators'
import { triggerCicdRun } from '@/server/cicd-integration-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, CicdTriggerBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { run: await triggerCicdRun({ integrationId: await getRouteId(ctx), ...parsed.data }) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
