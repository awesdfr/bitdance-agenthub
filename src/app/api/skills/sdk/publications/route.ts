import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listSkillMarketplacePublications } from '@/server/skills-service'

export async function GET() {
  try {
    return NextResponse.json({ publications: await listSkillMarketplacePublications() })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
