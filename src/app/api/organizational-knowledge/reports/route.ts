import { NextRequest, NextResponse } from 'next/server'

import { listOrganizationalLearningReports } from '@/server/organizational-learning-service'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = Number(searchParams.get('limit') ?? 100)
  return NextResponse.json({
    organizationalLearningReports: await listOrganizationalLearningReports(
      Number.isFinite(limit) ? limit : 100,
    ),
  })
}
