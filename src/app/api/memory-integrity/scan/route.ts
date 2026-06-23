import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MemoryIntegrityScanBody } from '@/server/control-plane-validators'
import { scanMemoryIntegrity } from '@/server/memory-integrity-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, MemoryIntegrityScanBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      scan: await scanMemoryIntegrity(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
