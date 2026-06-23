import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { FutureTechRadarStatus, FutureTechStage } from '@/db/schema'
import { FutureTechRadarItemBody } from '@/server/control-plane-validators'
import {
  createFutureTechRadarItem,
  listFutureTechRadarItems,
} from '@/server/future-tech-adapter-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    futureTechRadarItems: await listFutureTechRadarItems({
      stage: (req.nextUrl.searchParams.get('stage') ?? undefined) as
        | FutureTechStage
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | FutureTechRadarStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, FutureTechRadarItemBody)
  if (!parsed.ok) return parsed.response
  try {
    const futureTechRadarItem = await createFutureTechRadarItem(parsed.data)
    return NextResponse.json({ futureTechRadarItem }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
