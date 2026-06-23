import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { BlackboardEntryBody } from '@/server/control-plane-validators'
import { listBlackboardEntries, writeBlackboardEntry } from '@/server/collaboration-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    blackboardEntries: await listBlackboardEntries({
      scopeType:
        (req.nextUrl.searchParams.get('scopeType') as
          | 'workflow_run'
          | 'project'
          | 'workspace'
          | 'global'
          | null) ?? undefined,
      scopeId: req.nextUrl.searchParams.get('scopeId') ?? undefined,
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, BlackboardEntryBody)
  if (!parsed.ok) return parsed.response
  try {
    const blackboardEntry = await writeBlackboardEntry(parsed.data)
    return NextResponse.json({ blackboardEntry }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
