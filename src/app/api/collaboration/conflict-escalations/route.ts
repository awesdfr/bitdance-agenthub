import { NextRequest, NextResponse } from 'next/server'

import { listConflictEscalations } from '@/server/collaboration-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    conflictEscalations: await listConflictEscalations(
      req.nextUrl.searchParams.get('conflictResolutionId') ?? undefined,
    ),
  })
}
