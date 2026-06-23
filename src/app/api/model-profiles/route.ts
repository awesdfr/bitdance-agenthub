import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { createModelProfile, listModelProfiles } from '@/server/control-plane-service'
import { ModelProfileBody } from '@/server/control-plane-validators'

export async function GET() {
  return NextResponse.json({ modelProfiles: await listModelProfiles() })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ModelProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    const modelProfile = await createModelProfile(parsed.data)
    return NextResponse.json({ modelProfile }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
