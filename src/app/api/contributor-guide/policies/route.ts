import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ContributionPolicyType, OpenSourceGovernanceStatus } from '@/db/schema'
import { ContributionPolicyBody } from '@/server/control-plane-validators'
import {
  createContributionPolicy,
  listContributionPolicies,
} from '@/server/contributor-guide-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    contributionPolicies: await listContributionPolicies({
      policyType: (req.nextUrl.searchParams.get('policyType') ?? undefined) as
        | ContributionPolicyType
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ContributionPolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    const contributionPolicy = await createContributionPolicy(parsed.data)
    return NextResponse.json({ contributionPolicy }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
