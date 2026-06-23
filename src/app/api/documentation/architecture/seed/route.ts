import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedDocumentationArchitecture } from '@/server/documentation-architecture-service'

export async function POST() {
  try {
    return NextResponse.json(await seedDocumentationArchitecture(), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
