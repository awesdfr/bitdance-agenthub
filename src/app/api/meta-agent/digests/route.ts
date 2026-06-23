import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { MetaAgentDigestBody } from '@/server/control-plane-validators'
import { generateMetaAgentDigest, listMetaAgentDigests } from '@/server/meta-agent-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') ?? 50)
  return NextResponse.json({
    metaAgentDigests: await listMetaAgentDigests(Number.isFinite(limit) ? limit : 50),
  })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, MetaAgentDigestBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(await generateMetaAgentDigest(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
