import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { createCliProfile, listCliProfiles } from '@/server/control-plane-service'
import { CliProfileBody } from '@/server/control-plane-validators'

export async function GET() {
  return NextResponse.json({ cliProfiles: await listCliProfiles() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, CliProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    const cliProfile = await createCliProfile(parsed.data)
    return NextResponse.json({ cliProfile }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
