import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { FileSystemBoundaryEvaluationBody } from '@/server/control-plane-validators'
import { evaluateFileSystemBoundary } from '@/server/file-system-boundary-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, FileSystemBoundaryEvaluationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ result: await evaluateFileSystemBoundary(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
