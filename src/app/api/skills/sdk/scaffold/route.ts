import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SkillSdkScaffoldBody } from '@/server/control-plane-validators'
import { scaffoldSkillSdkProject } from '@/server/skills-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SkillSdkScaffoldBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await scaffoldSkillSdkProject(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
