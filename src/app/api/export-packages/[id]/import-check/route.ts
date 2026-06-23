import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { runPackageImportCheck } from '@/server/export-package-service'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const packageImportCheck = await runPackageImportCheck({ packageId: id })
    return NextResponse.json({ packageImportCheck }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
