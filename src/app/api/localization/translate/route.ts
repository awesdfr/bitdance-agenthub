import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { LocalizationTranslateBody } from '@/server/control-plane-validators'
import { translate } from '@/server/localization-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, LocalizationTranslateBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ translation: await translate(parsed.data) })
  } catch (err) {
    return errorResponse(err)
  }
}
