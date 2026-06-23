import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { CopyrightCheckStatus } from '@/db/schema'
import { CopyrightCheckBody } from '@/server/control-plane-validators'
import {
  createCopyrightCheck,
  listCopyrightChecks,
} from '@/server/content-safety-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      checks: await listCopyrightChecks({
        scanId: req.nextUrl.searchParams.get('scanId') ?? undefined,
        agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | CopyrightCheckStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, CopyrightCheckBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ check: await createCopyrightCheck(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
