import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedOSInterferencePolicy } from '@/server/os-interference-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedOSInterferencePolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
