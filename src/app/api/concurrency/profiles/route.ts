import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ConcurrencyProfileStatus } from '@/db/schema'
import { ConcurrencyProfileBody } from '@/server/control-plane-validators'
import {
  createConcurrencyProfile,
  listConcurrencyProfiles,
} from '@/server/concurrency-model-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    concurrencyProfiles: await listConcurrencyProfiles({
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | ConcurrencyProfileStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ConcurrencyProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    const concurrencyProfile = await createConcurrencyProfile(parsed.data)
    return NextResponse.json({ concurrencyProfile }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
