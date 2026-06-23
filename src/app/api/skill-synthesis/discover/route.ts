import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SkillSynthesisDiscoveryBody } from '@/server/control-plane-validators'
import { discoverSkillSynthesis } from '@/server/skill-synthesis-service'

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, SkillSynthesisDiscoveryBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      { record: await discoverSkillSynthesis(parsed.data) },
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
