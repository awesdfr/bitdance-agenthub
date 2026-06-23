import { NextRequest, NextResponse } from 'next/server'

import { getSdkAgent, listSdkAgents } from '@/server/programmatic-api-service'

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  if (name) return NextResponse.json({ agentProfile: await getSdkAgent(name) })
  return NextResponse.json({ agentProfiles: await listSdkAgents() })
}
