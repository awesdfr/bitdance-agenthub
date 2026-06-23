import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { NaturalLanguageWorkflowConfirmBody } from '@/server/control-plane-validators'
import { confirmNaturalLanguageWorkflowDraft } from '@/server/natural-language-workflow-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, NaturalLanguageWorkflowConfirmBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      await confirmNaturalLanguageWorkflowDraft(await getRouteId(ctx), parsed.data),
    )
  } catch (err) {
    return errorResponse(err)
  }
}
