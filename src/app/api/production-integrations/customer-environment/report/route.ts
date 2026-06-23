import { NextResponse } from 'next/server'

import { getProductionCustomerEnvironmentReport } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ report: await getProductionCustomerEnvironmentReport() })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build customer environment report.' },
      { status: 500 },
    )
  }
}
