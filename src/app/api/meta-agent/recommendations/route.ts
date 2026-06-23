import { NextRequest, NextResponse } from 'next/server'

import type { MetaAgentRecommendationStatus } from '@/db/schema'
import { listMetaAgentRecommendations } from '@/server/meta-agent-service'

const statuses = new Set(['open', 'approved', 'dismissed', 'applied'])

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    metaAgentRecommendations: await listMetaAgentRecommendations({
      digestId: searchParams.get('digestId') ?? undefined,
      status: status && statuses.has(status) ? (status as MetaAgentRecommendationStatus) : undefined,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
  })
}
