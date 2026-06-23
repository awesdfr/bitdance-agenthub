import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { IdempotencyRecordBody } from '@/server/control-plane-validators'
import { createIdempotencyRecord, listIdempotencyRecords } from '@/server/recovery-service'

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '100')
  return NextResponse.json({
    idempotencyRecords: await listIdempotencyRecords(Number.isFinite(limit) ? limit : 100),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, IdempotencyRecordBody)
  if (!parsed.ok) return parsed.response
  try {
    const idempotencyRecord = await createIdempotencyRecord(parsed.data)
    return NextResponse.json({ idempotencyRecord }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
