import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { SkillMarketplacePublishBody } from '@/server/control-plane-validators'
import { publishSkillToMarketplace } from '@/server/skills-service'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const parsed = await parseJsonBody(req, SkillMarketplacePublishBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(
      {
        publication: await publishSkillToMarketplace({
          manifestId: await getRouteId(ctx),
          marketplaceUrl: parsed.data.marketplaceUrl,
        }),
      },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
