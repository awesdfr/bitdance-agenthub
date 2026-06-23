import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedBrandIdentity } from '@/server/brand-service'

export async function POST() {
  try {
    return NextResponse.json(await seedBrandIdentity(), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
