import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { AccessibilityProfileBody } from '@/server/control-plane-validators'
import {
  createAccessibilityProfile,
  listAccessibilityProfiles,
} from '@/server/accessibility-profile-service'

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status')
    const limit = req.nextUrl.searchParams.get('limit')
    return NextResponse.json({
      profiles: await listAccessibilityProfiles({
        status: status === 'active' || status === 'disabled' ? status : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, AccessibilityProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ profile: await createAccessibilityProfile(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
