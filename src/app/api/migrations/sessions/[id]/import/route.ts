import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MigrationImportBody } from '@/server/control-plane-validators'
import { importMigrationSession } from '@/server/migration-wizard-service'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const parsed = await parseJsonBody(req, MigrationImportBody)
  if (!parsed.ok) return parsed.response
  try {
    const { id } = await params
    return NextResponse.json(await importMigrationSession(id, parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
