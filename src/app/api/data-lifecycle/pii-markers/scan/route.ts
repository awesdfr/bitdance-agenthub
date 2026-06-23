import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { PiiScanBody } from '@/server/control-plane-validators'
import { scanMemoryForPii } from '@/server/data-lifecycle-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, PiiScanBody)
    if (!parsed.ok) return parsed.response
    const piiMarkers = await scanMemoryForPii(parsed.data)
    return NextResponse.json({ piiMarkers }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
