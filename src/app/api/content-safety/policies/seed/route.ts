import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedContentSafetyPolicies } from '@/server/content-safety-service'

export async function POST() {
  try {
    return NextResponse.json({ policies: await seedContentSafetyPolicies() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
