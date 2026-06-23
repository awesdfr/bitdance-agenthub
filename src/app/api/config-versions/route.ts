import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import {
  ConfigEntityTypeSchema,
  ConfigVersionBody,
} from '@/server/control-plane-validators'
import {
  captureConfigVersion,
  listConfigVersions,
} from '@/server/config-version-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const entityTypeParam = searchParams.get('entityType')
  const parsedEntityType = entityTypeParam ? ConfigEntityTypeSchema.safeParse(entityTypeParam) : null
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    configVersions: await listConfigVersions({
      entityType: parsedEntityType?.success ? parsedEntityType.data : undefined,
      entityId: searchParams.get('entityId') ?? undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ConfigVersionBody)
    if (!parsed.ok) return parsed.response
    const configVersion = await captureConfigVersion(parsed.data)
    return NextResponse.json({ configVersion }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
