import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listMigrationImportRecords } from '@/server/migration-wizard-service'

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId') ?? undefined
    return NextResponse.json({
      records: await listMigrationImportRecords({ sessionId }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
