import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { getSkillsMapIntegrationReport } from '@/server/skillsmap-integration-service'

export async function GET() {
  try {
    const report = await getSkillsMapIntegrationReport()
    return NextResponse.json({ report })
  } catch (err) {
    return errorResponse(err)
  }
}
