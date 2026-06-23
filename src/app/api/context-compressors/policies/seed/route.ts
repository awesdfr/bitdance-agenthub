import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedContextCompressorPolicies } from '@/server/prompt-context-service'

export async function POST() {
  try {
    return NextResponse.json({ policies: await seedContextCompressorPolicies() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
