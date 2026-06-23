import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ContextCacheResolveBody } from '@/server/control-plane-validators'
import { resolveContextCache } from '@/server/context-preloader-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ContextCacheResolveBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ cache: await resolveContextCache(parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
