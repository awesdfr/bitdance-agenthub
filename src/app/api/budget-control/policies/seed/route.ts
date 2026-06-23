import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedBudgetPolicies } from '@/server/budget-control-service'

export async function POST() {
  try {
    return NextResponse.json({ policies: await seedBudgetPolicies() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
