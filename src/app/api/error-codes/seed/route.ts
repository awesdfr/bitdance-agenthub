import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedErrorCodeCatalog } from '@/server/error-code-catalog-service'

export async function POST() {
  try {
    return NextResponse.json({ errorCodes: await seedErrorCodeCatalog() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
