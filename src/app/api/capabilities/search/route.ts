import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { CapabilitySearchBody } from '@/server/control-plane-validators'
import { searchCapabilities } from '@/server/capability-graph-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, CapabilitySearchBody)
  if (!parsed.ok) return parsed.response
  try {
    const capabilitySearchResults = await searchCapabilities(parsed.data.query, parsed.data.limit)
    return NextResponse.json({ capabilitySearchResults })
  } catch (err) {
    return errorResponse(err)
  }
}
