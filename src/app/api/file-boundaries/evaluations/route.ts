import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import type { FileBoundaryEvaluationStatus, FileBoundaryOperation } from '@/db/schema'
import { listFileSystemBoundaryEvaluations } from '@/server/file-system-boundary-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      evaluations: await listFileSystemBoundaryEvaluations({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | FileBoundaryEvaluationStatus
          | undefined,
        operation: (req.nextUrl.searchParams.get('operation') ?? undefined) as
          | FileBoundaryOperation
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
