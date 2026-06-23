import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedSuccessMetricDefinitions } from '@/server/success-metrics-service'

export async function POST() {
  try {
    return NextResponse.json({ definitions: await seedSuccessMetricDefinitions() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
