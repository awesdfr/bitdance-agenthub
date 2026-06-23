import { NextRequest, NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { MigrationSourceToolSchema } from '@/server/control-plane-validators'
import { listMigrationWizardSessions } from '@/server/migration-wizard-service'

export async function GET(req: NextRequest) {
  try {
    const sourceTool = req.nextUrl.searchParams.get('sourceTool')
    return NextResponse.json({
      sessions: await listMigrationWizardSessions({
        sourceTool: sourceTool ? MigrationSourceToolSchema.parse(sourceTool) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
