import { NextResponse } from 'next/server'

import { getProductionModelCredentialReport } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ report: await getProductionModelCredentialReport() })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build production model credential report.' },
      { status: 500 },
    )
  }
}
