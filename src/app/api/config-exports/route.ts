import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ConfigExportBody } from '@/server/control-plane-validators'
import { createConfigExport, listConfigExports } from '@/server/config-version-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    configExports: await listConfigExports(Number.isFinite(limit) ? limit : 100),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ConfigExportBody)
    if (!parsed.ok) return parsed.response
    const configExport = await createConfigExport(parsed.data)
    return NextResponse.json({ configExport }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
