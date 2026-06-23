import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedReadinessChecklistItems } from '@/server/readiness-checklist-service'

export async function POST() {
  try {
    return NextResponse.json({ items: await seedReadinessChecklistItems() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
