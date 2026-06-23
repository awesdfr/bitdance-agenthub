import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { FeatureFlagBody } from '@/server/control-plane-validators'
import { createFeatureFlag, listFeatureFlags } from '@/server/feature-flag-service'

export async function GET() {
  try {
    return NextResponse.json({ featureFlags: await listFeatureFlags() })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, FeatureFlagBody)
    if (!parsed.ok) return parsed.response
    const featureFlag = await createFeatureFlag(parsed.data)
    return NextResponse.json({ featureFlag }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
