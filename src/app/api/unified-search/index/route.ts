import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { UnifiedSearchEntityType } from '@/db/schema'
import {
  UnifiedSearchEntityTypeSchema,
  UnifiedSearchIndexBody,
} from '@/server/control-plane-validators'
import { listUnifiedSearchEntries, upsertUnifiedSearchEntry } from '@/server/unified-search-service'

export async function GET(req: NextRequest) {
  try {
    const entityTypeParam = req.nextUrl.searchParams.get('entityType') ?? undefined
    const entityType = entityTypeParam
      ? UnifiedSearchEntityTypeSchema.parse(entityTypeParam)
      : undefined
    const projectName = req.nextUrl.searchParams.get('projectName') ?? undefined
    const limitParam = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      entries: await listUnifiedSearchEntries({
        entityType: entityType as UnifiedSearchEntityType | undefined,
        projectName,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, UnifiedSearchIndexBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { entry: await upsertUnifiedSearchEntry(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
