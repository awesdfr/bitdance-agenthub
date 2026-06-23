import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { evaluateRetentionPolicies } from '@/server/data-lifecycle-service'

export async function POST() {
  try {
    return NextResponse.json({ evaluations: await evaluateRetentionPolicies() })
  } catch (err) {
    return errorResponse(err)
  }
}
