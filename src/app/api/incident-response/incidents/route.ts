import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { IncidentReportBody, IncidentSeveritySchema } from '@/server/control-plane-validators'
import { createIncidentReport, listIncidentReports } from '@/server/incident-response-service'

export async function GET(req: NextRequest) {
  try {
    const severity = req.nextUrl.searchParams.get('severity')
    return NextResponse.json({
      incidents: await listIncidentReports({
        severity: severity ? IncidentSeveritySchema.parse(severity) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, IncidentReportBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await createIncidentReport(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
