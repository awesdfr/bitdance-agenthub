import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedQuickReferenceItems } from '@/server/quick-reference-service'

export async function POST() {
  try {
    return NextResponse.json({ items: await seedQuickReferenceItems() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
