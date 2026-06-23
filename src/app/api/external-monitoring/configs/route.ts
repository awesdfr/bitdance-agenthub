import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ExternalMonitoringStatus } from '@/db/schema'
import { ExternalMonitoringConfigBody } from '@/server/control-plane-validators'
import {
  createExternalMonitoringConfig,
  listExternalMonitoringConfigs,
} from '@/server/external-monitoring-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      configs: await listExternalMonitoringConfigs({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as
          | ExternalMonitoringStatus
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ExternalMonitoringConfigBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ config: await createExternalMonitoringConfig(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
