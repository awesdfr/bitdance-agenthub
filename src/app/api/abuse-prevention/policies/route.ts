import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { AbusePreventionPolicyStatus } from '@/db/schema'
import { AbusePreventionPolicyBody } from '@/server/control-plane-validators'
import {
  createAbusePreventionPolicy,
  listAbusePreventionPolicies,
} from '@/server/abuse-prevention-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    abusePreventionPolicies: await listAbusePreventionPolicies({
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | AbusePreventionPolicyStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AbusePreventionPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    const abusePreventionPolicy = await createAbusePreventionPolicy(parsed.data)
    return NextResponse.json({ abusePreventionPolicy }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
