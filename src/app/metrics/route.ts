import { NextResponse } from 'next/server'

import { buildPrometheusMetrics } from '@/server/external-monitoring-service'

export async function GET() {
  return new NextResponse(await buildPrometheusMetrics(), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  })
}
