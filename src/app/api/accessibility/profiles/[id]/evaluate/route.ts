import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { evaluateAccessibilityProfile } from '@/server/accessibility-profile-service'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await evaluateAccessibilityProfile(await getRouteId(ctx)))
  } catch (err) {
    return errorResponse(err)
  }
}
