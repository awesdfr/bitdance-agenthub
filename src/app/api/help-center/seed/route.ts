import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedHelpCenter } from '@/server/help-center-service'

export async function POST() {
  try {
    return NextResponse.json(await seedHelpCenter(), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
