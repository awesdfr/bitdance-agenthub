import { NextResponse } from 'next/server'

import { getProductionSetupGuide } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ setupGuide: await getProductionSetupGuide() })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build production setup guide.' },
      { status: 500 },
    )
  }
}
