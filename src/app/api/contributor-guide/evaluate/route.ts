import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ContributorEnvironmentBody } from '@/server/control-plane-validators'
import { evaluateContributorEnvironment } from '@/server/contributor-guide-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ContributorEnvironmentBody)
  if (!parsed.ok) return parsed.response
  try {
    const checks = await evaluateContributorEnvironment(parsed.data)
    return NextResponse.json({ checks })
  } catch (err) {
    return errorResponse(err)
  }
}
