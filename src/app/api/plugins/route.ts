import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { PluginExtensionPoint, PluginMarketplaceMetadata, PluginStatus } from '@/db/schema'
import { PluginInstallBody } from '@/server/control-plane-validators'
import { installPlugin, listPlugins } from '@/server/plugin-framework-service'

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({
      plugins: await listPlugins({
        status: (req.nextUrl.searchParams.get('status') ?? undefined) as PluginStatus | undefined,
        source: (req.nextUrl.searchParams.get('source') ?? undefined) as
          | PluginMarketplaceMetadata['source']
          | undefined,
        extensionPoint: (req.nextUrl.searchParams.get('extensionPoint') ?? undefined) as
          | PluginExtensionPoint
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
    const parsed = await parseJsonBody(req, PluginInstallBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ plugin: await installPlugin(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
