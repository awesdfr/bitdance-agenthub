import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { BrowserSessionExportBody } from '@/server/control-plane-validators'
import { planBrowserSessionExport } from '@/server/browser-session-service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const parsed = await parseJsonBody(req, BrowserSessionExportBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ exportPlan: await planBrowserSessionExport(id, parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
