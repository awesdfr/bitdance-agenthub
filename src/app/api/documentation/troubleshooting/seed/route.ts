import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedTroubleshootingEntries } from '@/server/troubleshooting-service'

export async function POST() {
  try {
    return NextResponse.json({ entries: await seedTroubleshootingEntries() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
