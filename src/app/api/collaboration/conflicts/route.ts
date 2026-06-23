import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ConflictResolutionBody } from '@/server/control-plane-validators'
import {
  createConflictResolution,
  listConflictResolutions,
} from '@/server/collaboration-service'

export async function GET() {
  return NextResponse.json({ conflictResolutions: await listConflictResolutions() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ConflictResolutionBody)
  if (!parsed.ok) return parsed.response
  try {
    const conflictResolution = await createConflictResolution(parsed.data)
    return NextResponse.json({ conflictResolution }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
