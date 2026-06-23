import { NextRequest, NextResponse } from 'next/server'

import { listPlaybooks } from '@/server/learning-service'

export async function GET(req: NextRequest) {
  const agentProfileId = req.nextUrl.searchParams.get('agentProfileId') ?? undefined
  return NextResponse.json({ playbooks: await listPlaybooks(agentProfileId) })
}
