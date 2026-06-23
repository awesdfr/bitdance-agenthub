import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedEthicalAlignmentPolicy } from '@/server/ethical-alignment-service'

export async function POST() {
  try {
    return NextResponse.json(
      { policy: await seedEthicalAlignmentPolicy() },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
