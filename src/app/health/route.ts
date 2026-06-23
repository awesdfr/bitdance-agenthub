import { NextResponse } from 'next/server'

import { getHealthProbe } from '@/server/external-monitoring-service'

export async function GET() {
  const probe = await getHealthProbe()
  return NextResponse.json(probe, { status: probe.status === 'ok' ? 200 : 503 })
}
