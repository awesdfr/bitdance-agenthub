import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { GovernanceRfcStatus } from '@/db/schema'
import { GovernanceRfcDecisionBody } from '@/server/control-plane-validators'
import {
  createGovernanceRfc,
  listGovernanceRfcs,
} from '@/server/open-source-governance-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    governanceRfcs: await listGovernanceRfcs({
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | GovernanceRfcStatus
        | undefined,
      proposer: req.nextUrl.searchParams.get('proposer') ?? undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, GovernanceRfcDecisionBody)
  if (!parsed.ok) return parsed.response
  try {
    const governanceRfc = await createGovernanceRfc(parsed.data)
    return NextResponse.json({ governanceRfc }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
