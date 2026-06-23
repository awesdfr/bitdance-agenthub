import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { seedStreamProtocolChannels } from '@/server/streaming-protocol-service'

export async function POST() {
  try {
    return NextResponse.json({ channels: await seedStreamProtocolChannels() }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
