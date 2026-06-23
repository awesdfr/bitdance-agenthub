import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ModelBehaviorSnapshotBody } from '@/server/control-plane-validators'
import {
  createModelBehaviorSnapshot,
  listModelBehaviorSnapshots,
} from '@/server/prompt-drift-service'

export async function GET(req: NextRequest) {
  try {
    const pinnedParam = req.nextUrl.searchParams.get('pinned')
    return NextResponse.json({
      snapshots: await listModelBehaviorSnapshots({
        monitorId: req.nextUrl.searchParams.get('monitorId') ?? undefined,
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        modelProfileId: req.nextUrl.searchParams.get('modelProfileId') ?? undefined,
        modelName: req.nextUrl.searchParams.get('modelName') ?? undefined,
        pinned: pinnedParam === null ? undefined : pinnedParam === 'true',
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ModelBehaviorSnapshotBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ snapshot: await createModelBehaviorSnapshot(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
