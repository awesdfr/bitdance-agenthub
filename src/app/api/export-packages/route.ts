import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ExportPackageBody } from '@/server/control-plane-validators'
import { createExportPackage, listExportPackages } from '@/server/export-package-service'

export async function GET(req: NextRequest) {
  try {
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? 100)
    return NextResponse.json({
      exportPackages: await listExportPackages(Number.isFinite(limit) ? limit : 100),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ExportPackageBody)
    if (!parsed.ok) return parsed.response
    const exportPackage = await createExportPackage(parsed.data)
    return NextResponse.json({ exportPackage }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
