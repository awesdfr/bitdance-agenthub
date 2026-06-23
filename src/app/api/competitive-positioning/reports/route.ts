import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { CompetitivePositioningStatus } from '@/db/schema'
import { CompetitivePositioningReportBody } from '@/server/control-plane-validators'
import {
  createCompetitivePositioningReport,
  listCompetitivePositioningReports,
} from '@/server/competitive-positioning-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      reports: await listCompetitivePositioningReports({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | CompetitivePositioningStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, CompetitivePositioningReportBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      { report: await createCompetitivePositioningReport(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
