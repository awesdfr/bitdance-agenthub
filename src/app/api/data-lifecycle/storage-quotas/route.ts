import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { StorageQuotaBody } from '@/server/control-plane-validators'
import {
  computeStorageQuotaSnapshot,
  listStorageQuotaSnapshots,
} from '@/server/data-lifecycle-service'

export async function GET(req: NextRequest) {
  try {
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50)
    return NextResponse.json({
      storageQuotaSnapshots: await listStorageQuotaSnapshots(Number.isFinite(limit) ? limit : 50),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, StorageQuotaBody)
    if (!parsed.ok) return parsed.response
    const storageQuotaSnapshot = await computeStorageQuotaSnapshot(parsed.data)
    return NextResponse.json({ storageQuotaSnapshot }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
