import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { NaturalLanguageWorkflowReviseBody } from '@/server/control-plane-validators'
import { reviseNaturalLanguageWorkflowDraft } from '@/server/natural-language-workflow-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, NaturalLanguageWorkflowReviseBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      draft: await reviseNaturalLanguageWorkflowDraft(await getRouteId(ctx), parsed.data),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
