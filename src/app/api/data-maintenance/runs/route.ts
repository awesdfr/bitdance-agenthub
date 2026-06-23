import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { DataMaintenanceRunStatus } from '@/db/schema'
import { DataMaintenanceRunBody } from '@/server/control-plane-validators'
import {
  listDataMaintenanceRuns,
  runDataMaintenance,
} from '@/server/data-maintenance-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      runs: await listDataMaintenanceRuns({
        policyId: req.nextUrl.searchParams.get('policyId') ?? undefined,
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | DataMaintenanceRunStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, DataMaintenanceRunBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ run: await runDataMaintenance(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
