import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedDeprecationPolicyStages } from '@/server/deprecation-policy-service'

export async function POST() {
  try {
    return NextResponse.json({ stages: await seedDeprecationPolicyStages() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
