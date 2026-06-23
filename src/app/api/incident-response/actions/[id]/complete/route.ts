import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { CompleteIncidentActionBody } from '@/server/control-plane-validators'
import { completeIncidentResponseAction } from '@/server/incident-response-service'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const parsed = await parseJsonBody(req, CompleteIncidentActionBody)
  if (!parsed.ok) return parsed.response
  try {
    const { id } = await params
    return NextResponse.json({ action: await completeIncidentResponseAction(id, parsed.data.evidence) })
  } catch (err) {
    return errorResponse(err)
  }
}
