import { NextResponse } from 'next/server'

import { getProductionExecutionPreflightReport } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ preflight: await getProductionExecutionPreflightReport() })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build production execution preflight report' },
      { status: 500 },
    )
  }
}
