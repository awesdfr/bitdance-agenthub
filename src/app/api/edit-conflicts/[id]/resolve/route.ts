import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { EditConflictResolveBody } from '@/server/control-plane-validators'
import { resolveEditConflict } from '@/server/optimistic-lock-service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = await parseJsonBody(req, EditConflictResolveBody)
    if (!parsed.ok) return parsed.response
    const { id } = await params
    const editConflict = await resolveEditConflict(id, parsed.data)
    return NextResponse.json({ editConflict })
  } catch (err) {
    return errorResponse(err)
  }
}
