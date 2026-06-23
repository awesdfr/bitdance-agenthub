import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { PluginUpgradeBody } from '@/server/control-plane-validators'
import { upgradePlugin } from '@/server/plugin-framework-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const parsed = await parseJsonBody(req, PluginUpgradeBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ plugin: await upgradePlugin(await getRouteId(ctx), parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
