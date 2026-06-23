import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedLocalizationDefaults } from '@/server/localization-service'

export async function POST() {
  try {
    return NextResponse.json(await seedLocalizationDefaults(), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
