import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getNetworkEgressReport } from '@/server/network-egress-report-service'

export async function GET() {
  try {
    const report = await getNetworkEgressReport()
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err)
  }
}
