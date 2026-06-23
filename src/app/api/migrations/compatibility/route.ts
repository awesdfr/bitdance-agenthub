import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MigrationCompatibilityBody } from '@/server/control-plane-validators'
import { checkMigrationCompatibility } from '@/server/migration-wizard-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, MigrationCompatibilityBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ session: await checkMigrationCompatibility(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
