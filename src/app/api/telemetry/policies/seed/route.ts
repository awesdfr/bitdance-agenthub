import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedTelemetryPolicy } from '@/server/telemetry-policy-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedTelemetryPolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
