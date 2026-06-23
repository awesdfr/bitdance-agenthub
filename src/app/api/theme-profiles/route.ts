import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ThemeProfileBody } from '@/server/control-plane-validators'
import { createThemeProfile, listThemeProfiles } from '@/server/theme-profile-service'

export async function GET() {
  try {
    return NextResponse.json({ themeProfiles: await listThemeProfiles() })
  } catch (err) {
    return errorResponse(err, 500)
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ThemeProfileBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ themeProfile: await createThemeProfile(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
