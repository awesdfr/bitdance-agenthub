import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import type { PluginLifecycleEventType } from '@/db/schema'
import { listPluginLifecycleEvents } from '@/server/plugin-framework-service'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json({
      events: await listPluginLifecycleEvents({
        pluginId: await getRouteId(ctx),
        eventType: (req.nextUrl.searchParams.get('eventType') ?? undefined) as
          | PluginLifecycleEventType
          | undefined,
        limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
