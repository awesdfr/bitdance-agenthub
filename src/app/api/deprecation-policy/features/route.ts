import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { FeatureDeprecationBody } from '@/server/control-plane-validators'
import { createFeatureDeprecation, listFeatureDeprecations } from '@/server/deprecation-policy-service'

export async function GET() {
  try {
    return NextResponse.json({ features: await listFeatureDeprecations() })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, FeatureDeprecationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ feature: await createFeatureDeprecation(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
