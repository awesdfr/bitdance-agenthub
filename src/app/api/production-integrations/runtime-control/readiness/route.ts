import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getRuntimeControlReadinessReport } from '@/server/production-integration-service'

export async function GET() {
  try {
    return NextResponse.json({ runtimeControl: await getRuntimeControlReadinessReport() })
  } catch (err) {
    return errorResponse(err)
  }
}
