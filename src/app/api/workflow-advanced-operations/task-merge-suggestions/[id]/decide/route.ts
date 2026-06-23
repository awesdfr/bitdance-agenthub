import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { TaskMergeDecisionBody } from '@/server/control-plane-validators'
import { decideTaskMergeSuggestion } from '@/server/workflow-advanced-operation-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, TaskMergeDecisionBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      taskMergeSuggestion: await decideTaskMergeSuggestion(
        await getRouteId(ctx),
        parsed.data.decision,
        parsed.data.note,
      ),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
