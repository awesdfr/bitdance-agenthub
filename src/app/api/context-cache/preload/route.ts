import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ContextPreloadBody } from '@/server/control-plane-validators'
import { planContextPreload } from '@/server/context-preloader-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ContextPreloadBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { cache: await planContextPreload(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
