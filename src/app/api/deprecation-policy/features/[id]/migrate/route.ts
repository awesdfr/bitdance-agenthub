import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { DeprecationMigrationRunBody } from '@/server/control-plane-validators'
import { runDeprecationMigration } from '@/server/deprecation-policy-service'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const parsed = await parseJsonBody(req, DeprecationMigrationRunBody)
  if (!parsed.ok) return parsed.response
  try {
    const { id } = await params
    return NextResponse.json({
      migrationRun: await runDeprecationMigration({
        featureDeprecationId: id,
        ...parsed.data,
      }),
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
