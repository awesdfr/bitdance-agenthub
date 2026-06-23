import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedPromptEngineeringGuide } from '@/server/prompt-engineering-guide-service'

export async function POST() {
  try {
    return NextResponse.json(await seedPromptEngineeringGuide(), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
