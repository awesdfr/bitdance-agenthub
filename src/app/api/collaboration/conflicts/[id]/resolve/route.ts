import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ConflictResolveBody } from '@/server/control-plane-validators'
import { resolveConflictResolution } from '@/server/collaboration-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, ConflictResolveBody)
  if (!parsed.ok) return parsed.response
  try {
    const conflictResolution = await resolveConflictResolution(
      await getRouteId(ctx),
      parsed.data.resolution,
    )
    return NextResponse.json({ conflictResolution })
  } catch (err) {
    return errorResponse(err)
  }
}
