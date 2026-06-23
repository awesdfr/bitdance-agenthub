import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ThemeResolveBody } from '@/server/control-plane-validators'
import { resolveThemeProfile } from '@/server/theme-profile-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ThemeResolveBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await resolveThemeProfile(parsed.data))
  } catch (err) {
    return errorResponse(err)
  }
}
