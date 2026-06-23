import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { GovernanceRfcAdvanceBody } from '@/server/control-plane-validators'
import { advanceGovernanceRfc } from '@/server/open-source-governance-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, context: RouteContext) {
  const parsed = await parseJsonBody(req, GovernanceRfcAdvanceBody)
  if (!parsed.ok) return parsed.response
  try {
    const { id } = await context.params
    const governanceRfc = await advanceGovernanceRfc(id, parsed.data)
    return NextResponse.json({ governanceRfc })
  } catch (err) {
    return errorResponse(err)
  }
}
