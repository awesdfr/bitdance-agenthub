import { NextResponse } from 'next/server'

import { getRunActivitySummary } from '@/server/run-activity-summary-service'

export async function GET() {
  const summary = await getRunActivitySummary()
  return NextResponse.json(summary)
}
