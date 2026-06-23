import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { E2EEncryptionPolicyStatus } from '@/db/schema'
import { E2EEncryptionPolicyBody } from '@/server/control-plane-validators'
import {
  createE2EEncryptionPolicy,
  listE2EEncryptionPolicies,
} from '@/server/e2e-encryption-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    e2eEncryptionPolicies: await listE2EEncryptionPolicies({
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | E2EEncryptionPolicyStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, E2EEncryptionPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    const e2eEncryptionPolicy = await createE2EEncryptionPolicy(parsed.data)
    return NextResponse.json({ e2eEncryptionPolicy }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
