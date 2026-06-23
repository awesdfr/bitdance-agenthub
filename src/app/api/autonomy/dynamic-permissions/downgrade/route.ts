import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { DynamicPermissionDowngradeBody } from '@/server/control-plane-validators'
import { downgradeDynamicPermissionsForAnomaly } from '@/server/dynamic-permission-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, DynamicPermissionDowngradeBody)
  if (!parsed.ok) return parsed.response
  try {
    const dynamicPermissionGrants = await downgradeDynamicPermissionsForAnomaly(parsed.data)
    return NextResponse.json({ dynamicPermissionGrants })
  } catch (err) {
    return errorResponse(err)
  }
}
