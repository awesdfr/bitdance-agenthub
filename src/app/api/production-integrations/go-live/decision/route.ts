import { NextResponse } from 'next/server'

import { createProductionGoLiveDecision } from '@/server/production-integration-service'

export async function POST() {
  try {
    return NextResponse.json({ decision: await createProductionGoLiveDecision() }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
