import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MetaAgentProfileBody } from '@/server/control-plane-validators'
import { createMetaAgentProfile, listMetaAgentProfiles } from '@/server/meta-agent-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') ?? 50)
  return NextResponse.json({
    metaAgentProfiles: await listMetaAgentProfiles(Number.isFinite(limit) ? limit : 50),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, MetaAgentProfileBody)
    if (!parsed.ok) return parsed.response
    const metaAgentProfile = await createMetaAgentProfile(parsed.data)
    return NextResponse.json({ metaAgentProfile }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
