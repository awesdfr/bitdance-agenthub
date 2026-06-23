import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ArchitecturePatternKey, OpenSourceGovernanceStatus } from '@/db/schema'
import { ArchitecturePatternBody } from '@/server/control-plane-validators'
import {
  createArchitecturePattern,
  listArchitecturePatterns,
} from '@/server/architecture-pattern-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    architecturePatterns: await listArchitecturePatterns({
      patternKey: (req.nextUrl.searchParams.get('patternKey') ?? undefined) as
        | ArchitecturePatternKey
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ArchitecturePatternBody)
  if (!parsed.ok) return parsed.response
  try {
    const architecturePattern = await createArchitecturePattern(parsed.data)
    return NextResponse.json({ architecturePattern }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
