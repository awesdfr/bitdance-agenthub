import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedOutputConsistencyPolicy } from '@/server/output-consistency-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedOutputConsistencyPolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
