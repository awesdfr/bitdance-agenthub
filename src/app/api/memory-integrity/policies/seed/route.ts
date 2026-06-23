import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedMemoryIntegrityPolicy } from '@/server/memory-integrity-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedMemoryIntegrityPolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
