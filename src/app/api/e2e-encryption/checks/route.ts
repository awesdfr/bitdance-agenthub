import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { E2EEncryptionCheckScope, E2EEncryptionCheckStatus } from '@/db/schema'
import { E2EEncryptionCheckBody } from '@/server/control-plane-validators'
import {
  evaluateE2EEncryption,
  listE2EEncryptionChecks,
} from '@/server/e2e-encryption-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    e2eEncryptionChecks: await listE2EEncryptionChecks({
      policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
      scope: (req.nextUrl.searchParams.get('scope') ?? undefined) as
        | E2EEncryptionCheckScope
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | E2EEncryptionCheckStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, E2EEncryptionCheckBody)
  if (!parsed.ok) return parsed.response
  try {
    const e2eEncryptionCheck = await evaluateE2EEncryption(parsed.data)
    return NextResponse.json({ e2eEncryptionCheck }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
