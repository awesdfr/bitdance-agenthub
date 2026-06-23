import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { DataExportManifestBody } from '@/server/control-plane-validators'
import {
  createDataExportManifest,
  listDataExportManifests,
} from '@/server/data-lifecycle-service'

export async function GET(req: NextRequest) {
  try {
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50)
    return NextResponse.json({
      dataExportManifests: await listDataExportManifests(Number.isFinite(limit) ? limit : 50),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, DataExportManifestBody)
    if (!parsed.ok) return parsed.response
    const dataExportManifest = await createDataExportManifest(parsed.data)
    return NextResponse.json({ dataExportManifest }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
