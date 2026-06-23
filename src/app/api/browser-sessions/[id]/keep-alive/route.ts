import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { BrowserSessionKeepAliveBody } from '@/server/control-plane-validators'
import { planBrowserSessionKeepAlive } from '@/server/browser-session-service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const parsed = await parseJsonBody(req, BrowserSessionKeepAliveBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ plan: await planBrowserSessionKeepAlive(id, parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
