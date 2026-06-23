import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { OptimisticEditCommitBody } from '@/server/control-plane-validators'
import { commitOptimisticEdit } from '@/server/optimistic-lock-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, OptimisticEditCommitBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(await commitOptimisticEdit(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
