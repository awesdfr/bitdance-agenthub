import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { PluginInstallBody } from '@/server/control-plane-validators'
import { installPlugin } from '@/server/plugin-framework-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, PluginInstallBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json({ plugin: await installPlugin(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
