import { NextResponse } from 'next/server'

import { getMaintenanceState } from '@/server/maintenance-service'

export async function GET() {
  return NextResponse.json(await getMaintenanceState())
}
