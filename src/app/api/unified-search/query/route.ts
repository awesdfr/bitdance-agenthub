import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { UnifiedSearchQueryBody } from '@/server/control-plane-validators'
import { searchUnifiedIndex } from '@/server/unified-search-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, UnifiedSearchQueryBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ results: await searchUnifiedIndex(parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
