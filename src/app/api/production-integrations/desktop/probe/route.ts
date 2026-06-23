import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { probeDesktopAutomation } from '@/server/production-integration-service'

const DesktopProbeBody = z.object({
  live: z.boolean().optional(),
  includeWindowList: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, DesktopProbeBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ desktop: await probeDesktopAutomation(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
