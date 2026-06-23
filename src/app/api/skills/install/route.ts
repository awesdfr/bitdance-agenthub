import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SkillInstallBody } from '@/server/control-plane-validators'
import { installSkill } from '@/server/skills-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SkillInstallBody)
  if (!parsed.ok) return parsed.response
  try {
    const result = await installSkill(parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
