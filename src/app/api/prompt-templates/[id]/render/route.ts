import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { PromptTemplateRenderBody } from '@/server/control-plane-validators'
import { renderPromptTemplate } from '@/server/prompt-context-service'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsed = await parseJsonBody(req, PromptTemplateRenderBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      render: await renderPromptTemplate({
        templateId: await getRouteId(ctx),
        ...parsed.data,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
