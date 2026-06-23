import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import {
  BrowserSessionBody,
  BrowserSessionStatusSchema,
} from '@/server/control-plane-validators'
import { listBrowserSessions, registerBrowserSession } from '@/server/browser-session-service'

export async function GET(req: NextRequest) {
  try {
    const ownerAgentProfileId = req.nextUrl.searchParams.get('ownerAgentProfileId') ?? undefined
    const statusParam = req.nextUrl.searchParams.get('status') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      browserSessions: await listBrowserSessions({
        ownerAgentProfileId,
        status: statusParam ? BrowserSessionStatusSchema.parse(statusParam) : undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, BrowserSessionBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { browserSession: await registerBrowserSession(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
