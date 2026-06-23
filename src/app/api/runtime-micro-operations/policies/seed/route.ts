import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedRuntimeMicroOperationPolicy } from '@/server/runtime-micro-operation-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedRuntimeMicroOperationPolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
