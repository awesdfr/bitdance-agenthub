import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedAccessibilityProfiles } from '@/server/accessibility-profile-service'

export async function POST() {
  try {
    return NextResponse.json({ profiles: await seedAccessibilityProfiles() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
