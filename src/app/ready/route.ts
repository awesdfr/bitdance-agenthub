import { NextResponse } from 'next/server'

import { getReadyProbe } from '@/server/external-monitoring-service'

export async function GET() {
  const probe = await getReadyProbe()
  return NextResponse.json(probe, { status: probe.ready ? 200 : 503 })
}
