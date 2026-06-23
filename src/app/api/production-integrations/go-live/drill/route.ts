import { NextResponse } from 'next/server'

import { getProductionGoLiveDrillReport } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ drill: await getProductionGoLiveDrillReport() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
