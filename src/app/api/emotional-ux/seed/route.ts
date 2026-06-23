import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedEmotionalUxGuidelines } from '@/server/emotional-ux-service'

export async function POST() {
  try {
    return NextResponse.json(
      { guidelines: await seedEmotionalUxGuidelines() },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
