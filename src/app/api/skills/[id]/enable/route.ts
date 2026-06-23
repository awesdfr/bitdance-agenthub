import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRouteId, parseJsonBody } from '@/app/api/control-plane-utils'
import { SkillEnableBody } from '@/server/control-plane-validators'
import { setSkillEnabled } from '@/server/skills-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const parsed = await parseJsonBody(req, SkillEnableBody)
  if (!parsed.ok) return parsed.response
  try {
    const skill = await setSkillEnabled(await getRouteId(ctx), parsed.data.enabled)
    return NextResponse.json({ skill })
  } catch (err) {
    return errorResponse(err)
  }
}
