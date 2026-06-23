import { NextResponse } from 'next/server'

import { errorResponse } from '@/app/api/control-plane-utils'
import { listLocalizationSettings } from '@/server/localization-service'

export async function GET() {
  try {
    return NextResponse.json({ settings: await listLocalizationSettings() })
  } catch (err) {
    return errorResponse(err, 500)
  }
}
