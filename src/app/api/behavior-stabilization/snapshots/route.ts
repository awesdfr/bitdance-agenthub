import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { BehaviorSnapshotKind } from '@/db/schema'
import { BehaviorSnapshotBody } from '@/server/control-plane-validators'
import {
  listBehaviorSnapshots,
  recordBehaviorSnapshot,
} from '@/server/behavior-stabilization-service'

export async function GET(req: NextRequest) {
  try {
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const kind = req.nextUrl.searchParams.get('kind') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      snapshots: await listBehaviorSnapshots({
        agentProfileId,
        kind: kind as BehaviorSnapshotKind | undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, BehaviorSnapshotBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { snapshot: await recordBehaviorSnapshot(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
