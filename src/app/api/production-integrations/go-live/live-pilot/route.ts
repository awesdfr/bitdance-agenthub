import { NextResponse } from 'next/server'

import { createProductionLivePilotLease } from '@/server/production-integration-service'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const durationMinutes =
      body && typeof body === 'object' && typeof body.durationMinutes === 'number'
        ? body.durationMinutes
        : undefined
    return NextResponse.json(
      { lease: await createProductionLivePilotLease({ durationMinutes }) },
      { status: 201 },
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
