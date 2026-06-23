import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { ConflictEscalationBody } from '@/server/control-plane-validators'
import { advanceConflictEscalation } from '@/server/collaboration-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, ConflictEscalationBody)
  if (!parsed.ok) return parsed.response
  try {
    const result = await advanceConflictEscalation({
      conflictResolutionId: await getRouteId(ctx),
      ...parsed.data,
    })
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err, 404)
  }
}
