import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ContentSafetyScanBody } from '@/server/control-plane-validators'
import { scanContentSafetyOutput } from '@/server/content-safety-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ContentSafetyScanBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ scan: await scanContentSafetyOutput(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
