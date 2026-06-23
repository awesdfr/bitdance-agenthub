import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedModelInvocationOptimizationPolicy } from '@/server/model-invocation-optimization-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedModelInvocationOptimizationPolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
