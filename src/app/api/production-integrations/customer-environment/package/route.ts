import { NextResponse } from 'next/server'

import { createProductionCustomerEnvironmentPackage } from '@/server/production-integration-service'

export async function POST() {
  try {
    return NextResponse.json(
      { package: await createProductionCustomerEnvironmentPackage() },
      { status: 201 },
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to export customer environment package.' },
      { status: 500 },
    )
  }
}
