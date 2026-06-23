import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { OnboardingWorkTypeBody } from '@/server/control-plane-validators'
import { configureOnboardingAgent } from '@/server/onboarding-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, OnboardingWorkTypeBody)
  if (!parsed.ok) return parsed.response
  try {
    const onboardingSession = await configureOnboardingAgent(
      await getRouteId(ctx),
      parsed.data.workType,
    )
    return NextResponse.json({ onboardingSession })
  } catch (err) {
    return errorResponse(err, 404)
  }
}
