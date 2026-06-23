import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { applyPartialWorkflowRerun } from '@/server/workflow-advanced-operation-service'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json({ partialRerun: await applyPartialWorkflowRerun(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}
