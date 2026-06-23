import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { checkPluginCompatibility } from '@/server/plugin-framework-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const body = (await req.json().catch(() => ({}))) as { requiredCoreVersion?: string | null }
    return NextResponse.json({
      compatibility: await checkPluginCompatibility({
        pluginId: await getRouteId(ctx),
        requiredCoreVersion: body.requiredCoreVersion,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
