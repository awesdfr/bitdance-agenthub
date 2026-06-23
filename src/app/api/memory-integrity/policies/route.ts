import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { MemoryIntegrityPolicyStatus } from '@/db/schema'
import {
  createMemoryIntegrityPolicy,
  listMemoryIntegrityPolicies,
} from '@/server/memory-integrity-service'
import { MemoryIntegrityPolicyBody } from '@/server/control-plane-validators'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      policies: await listMemoryIntegrityPolicies({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | MemoryIntegrityPolicyStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 25),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, MemoryIntegrityPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({
      policy: await createMemoryIntegrityPolicy(parsed.data),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
