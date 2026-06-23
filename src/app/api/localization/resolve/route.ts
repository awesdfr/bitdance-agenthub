import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { LocalizationResolveBody } from '@/server/control-plane-validators'
import { resolveAgentOutputLocalization } from '@/server/localization-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, LocalizationResolveBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ localization: await resolveAgentOutputLocalization(parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
