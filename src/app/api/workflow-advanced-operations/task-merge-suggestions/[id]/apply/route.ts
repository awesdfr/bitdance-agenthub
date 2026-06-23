import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { applyTaskMergeSuggestion } from '@/server/workflow-advanced-operation-service'

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json({ taskMergeSuggestion: await applyTaskMergeSuggestion(await getRouteId(ctx)) })
  } catch (err) {
    return errorResponse(err)
  }
}
