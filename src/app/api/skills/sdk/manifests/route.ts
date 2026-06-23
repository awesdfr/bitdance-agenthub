import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { SkillSdkManifestBody } from '@/server/control-plane-validators'
import { createSkillSdkManifest, listSkillSdkManifests } from '@/server/skills-service'

export async function GET() {
  try {
    return NextResponse.json({ manifests: await listSkillSdkManifests() })
  } catch (err) {
    return errorResponse(err, 500)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SkillSdkManifestBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ manifest: await createSkillSdkManifest(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
