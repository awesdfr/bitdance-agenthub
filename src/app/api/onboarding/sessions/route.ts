import { NextResponse } from 'next/server'

import { listOnboardingSessions, startOnboardingSession } from '@/server/onboarding-service'

export async function GET() {
  return NextResponse.json({ onboardingSessions: await listOnboardingSessions() })
}

export async function POST() {
  const onboardingSession = await startOnboardingSession()
  return NextResponse.json({ onboardingSession }, { status: 201 })
}
