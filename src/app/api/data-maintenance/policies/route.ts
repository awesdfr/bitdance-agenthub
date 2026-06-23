import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { DataMaintenancePolicyStatus } from '@/db/schema'
import { DataMaintenancePolicyBody } from '@/server/control-plane-validators'
import {
  createDataMaintenancePolicy,
  listDataMaintenancePolicies,
} from '@/server/data-maintenance-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      policies: await listDataMaintenancePolicies({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | DataMaintenancePolicyStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 25),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, DataMaintenancePolicyBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ policy: await createDataMaintenancePolicy(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
