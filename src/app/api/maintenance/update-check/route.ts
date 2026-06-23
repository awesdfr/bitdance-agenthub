import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { UpdateCheckBody } from '@/server/control-plane-validators'
import { checkForApplicationUpdate } from '@/server/maintenance-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, UpdateCheckBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json(await checkForApplicationUpdate(parsed.data))
  } catch (err) {
    return errorResponse(err)
  }
}
