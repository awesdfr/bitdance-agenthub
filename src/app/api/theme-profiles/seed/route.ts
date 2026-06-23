import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedThemeProfiles } from '@/server/theme-profile-service'

export async function POST() {
  try {
    return NextResponse.json({ themeProfiles: await seedThemeProfiles() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
