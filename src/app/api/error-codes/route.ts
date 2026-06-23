import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { ErrorCodeCategory, OpenSourceGovernanceStatus } from '@/db/schema'
import { ErrorCodeCatalogEntryBody } from '@/server/control-plane-validators'
import {
  createErrorCodeCatalogEntry,
  listErrorCodeCatalog,
} from '@/server/error-code-catalog-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    errorCodes: await listErrorCodeCatalog({
      category: (req.nextUrl.searchParams.get('category') ?? undefined) as
        | ErrorCodeCategory
        | undefined,
      code: req.nextUrl.searchParams.get('code') ?? undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ErrorCodeCatalogEntryBody)
  if (!parsed.ok) return parsed.response
  try {
    const errorCode = await createErrorCodeCatalogEntry(parsed.data)
    return NextResponse.json({ errorCode }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
