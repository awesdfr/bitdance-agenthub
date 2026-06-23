import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { discoverMobileAutomation } from '@/server/production-integration-service'

const MobileDiscoveryBody = z.object({
  live: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, MobileDiscoveryBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ mobile: await discoverMobileAutomation(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
