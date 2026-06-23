import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedNonGoalPolicies } from '@/server/non-goal-policy-service'

export async function POST() {
  try {
    return NextResponse.json({ policies: await seedNonGoalPolicies() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
