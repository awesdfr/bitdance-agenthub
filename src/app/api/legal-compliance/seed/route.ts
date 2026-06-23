import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedLegalCompliance } from '@/server/legal-compliance-service'

export async function POST() {
  try {
    return NextResponse.json(await seedLegalCompliance(), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
