import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { OpenSourceGovernanceStatus, SourceLicenseLayer } from '@/db/schema'
import { OpenSourceComponentBody } from '@/server/control-plane-validators'
import {
  createOpenSourceComponent,
  listOpenSourceComponents,
} from '@/server/open-source-governance-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    openSourceComponents: await listOpenSourceComponents({
      layer: (req.nextUrl.searchParams.get('layer') ?? undefined) as
        | SourceLicenseLayer
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 50),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, OpenSourceComponentBody)
  if (!parsed.ok) return parsed.response
  try {
    const openSourceComponent = await createOpenSourceComponent(parsed.data)
    return NextResponse.json({ openSourceComponent }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
