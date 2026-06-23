import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { BrowserSessionAccessBody } from '@/server/control-plane-validators'
import { evaluateBrowserSessionAccess } from '@/server/browser-session-service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const parsed = await parseJsonBody(req, BrowserSessionAccessBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ evaluation: await evaluateBrowserSessionAccess(id, parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
