import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import type { OpenSourceGovernanceStatus, ToolProtocolSource } from '@/db/schema'
import { ToolProtocolManifestBody } from '@/server/control-plane-validators'
import {
  createToolProtocolManifest,
  listToolProtocolManifests,
} from '@/server/tool-invocation-protocol-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    toolProtocolManifests: await listToolProtocolManifests({
      source: (req.nextUrl.searchParams.get('source') ?? undefined) as
        | ToolProtocolSource
        | undefined,
      status: (req.nextUrl.searchParams.get('status') ?? undefined) as
        | OpenSourceGovernanceStatus
        | undefined,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    }),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ToolProtocolManifestBody)
  if (!parsed.ok) return parsed.response
  try {
    const manifest = await createToolProtocolManifest(parsed.data)
    return NextResponse.json({ manifest }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
