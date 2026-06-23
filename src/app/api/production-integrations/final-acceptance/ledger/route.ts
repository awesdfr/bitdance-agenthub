import { NextResponse } from 'next/server'

import { getProductionFinalAcceptanceLedger } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ ledger: await getProductionFinalAcceptanceLedger() })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
