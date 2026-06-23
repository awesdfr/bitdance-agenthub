import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedGlobalOSIntegrationPolicy } from '@/server/global-os-integration-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedGlobalOSIntegrationPolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
