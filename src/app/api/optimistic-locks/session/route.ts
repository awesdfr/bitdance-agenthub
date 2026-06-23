import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { OptimisticEditSessionBody } from '@/server/control-plane-validators'
import { startOptimisticEdit } from '@/server/optimistic-lock-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, OptimisticEditSessionBody)
    if (!parsed.ok) return parsed.response
    const optimisticLock = await startOptimisticEdit(parsed.data)
    return NextResponse.json({ optimisticLock }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
