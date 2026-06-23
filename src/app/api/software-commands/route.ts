import { NextResponse } from 'next/server'

import { listAllSoftwareCommands } from '@/server/control-plane-service'

export async function GET() {
  return NextResponse.json({ softwareCommands: await listAllSoftwareCommands() })
}
