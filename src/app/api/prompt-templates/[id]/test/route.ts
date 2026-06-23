import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { testPromptTemplate } from '@/server/prompt-context-service'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await testPromptTemplate(await getRouteId(ctx)))
  } catch (err) {
    return errorResponse(err, 404)
  }
}
