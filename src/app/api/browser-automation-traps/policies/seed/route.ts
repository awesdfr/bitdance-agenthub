import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedBrowserAutomationTrapPolicy } from '@/server/browser-automation-trap-service'

export async function POST() {
  try {
    return NextResponse.json({ policy: await seedBrowserAutomationTrapPolicy() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
