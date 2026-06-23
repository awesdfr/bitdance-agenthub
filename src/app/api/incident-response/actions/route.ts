import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listIncidentResponseActions } from '@/server/incident-response-service'

export async function GET(req: NextRequest) {
  try {
    const incidentId = req.nextUrl.searchParams.get('incidentId') ?? undefined
    return NextResponse.json({
      actions: await listIncidentResponseActions({ incidentId }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
