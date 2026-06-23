import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedReasonixFileFormats } from '@/server/reasonix-file-format-service'

export async function POST() {
  try {
    return NextResponse.json({ formats: await seedReasonixFileFormats() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
