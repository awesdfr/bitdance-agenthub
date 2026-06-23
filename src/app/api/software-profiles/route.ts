import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { createSoftwareProfile, listSoftwareProfiles } from '@/server/control-plane-service'
import { SoftwareProfileBody } from '@/server/control-plane-validators'

export async function GET() {
  return NextResponse.json({ softwareProfiles: await listSoftwareProfiles() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, SoftwareProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    const softwareProfile = await createSoftwareProfile(parsed.data)
    return NextResponse.json({ softwareProfile }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
