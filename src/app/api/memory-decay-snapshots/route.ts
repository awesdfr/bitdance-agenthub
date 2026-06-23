import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import {
  createMemoryDecaySnapshot,
  listMemoryDecaySnapshots,
} from '@/server/memory-decay-service'
import { MemoryDecaySnapshotBody } from '@/server/control-plane-validators'

export async function GET(req: NextRequest) {
  try {
    const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
    const limit = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      snapshots: await listMemoryDecaySnapshots({
        agentProfileId,
        limit: limit ? Number(limit) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, MemoryDecaySnapshotBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { snapshot: await createMemoryDecaySnapshot(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
