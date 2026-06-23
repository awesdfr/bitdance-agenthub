import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { completeOnboardingSession } from '@/server/onboarding-service'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const onboardingSession = await completeOnboardingSession(await getRouteId(ctx))
    return NextResponse.json({ onboardingSession })
  } catch (err) {
    return errorResponse(err, 404)
  }
}
