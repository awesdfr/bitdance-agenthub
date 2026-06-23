import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { createProductionOnsiteActivationPackage } from '@/server/production-integration-service'

export async function POST() {
  try {
    return NextResponse.json({ package: await createProductionOnsiteActivationPackage() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
