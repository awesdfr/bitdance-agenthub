import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedTrustCalibrationPolicies } from '@/server/trust-calibration-service'

export async function POST() {
  try {
    return NextResponse.json({ policies: await seedTrustCalibrationPolicies() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
