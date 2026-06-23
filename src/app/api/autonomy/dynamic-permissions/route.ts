import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { DynamicPermissionGrantStatus } from '@/db/schema'
import { DynamicPermissionRequestBody } from '@/server/control-plane-validators'
import {
  listDynamicPermissionGrants,
  requestDynamicPermission,
} from '@/server/dynamic-permission-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    dynamicPermissionGrants: await listDynamicPermissionGrants({
      agentProfileId: req.nextUrl.searchParams.get('agentProfileId') ?? undefined,
      employeeRunId: req.nextUrl.searchParams.get('employeeRunId') ?? undefined,
      permissionKey: req.nextUrl.searchParams.get('permissionKey') ?? undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | DynamicPermissionGrantStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, DynamicPermissionRequestBody)
  if (!parsed.ok) return parsed.response
  try {
    const dynamicPermissionGrant = await requestDynamicPermission(parsed.data)
    return NextResponse.json({ dynamicPermissionGrant }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
