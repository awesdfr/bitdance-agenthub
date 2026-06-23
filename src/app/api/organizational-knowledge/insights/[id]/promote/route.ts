import { NextResponse } from 'next/server'

import { errorResponse, getRouteId } from '@/app/api/control-plane-utils'
import { promoteOrganizationalInsight } from '@/server/organizational-learning-service'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const organizationalKnowledgeItem = await promoteOrganizationalInsight(await getRouteId(ctx))
    return NextResponse.json({ organizationalKnowledgeItem })
  } catch (err) {
    return errorResponse(err)
  }
}
