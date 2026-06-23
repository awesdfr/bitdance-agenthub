import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ReasonixFileValidationBody } from '@/server/control-plane-validators'
import { validateReasonixFile } from '@/server/reasonix-file-format-service'

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, ReasonixFileValidationBody)
  if (!parsed.ok) return parsed.response
  try {
    return NextResponse.json({ validation: await validateReasonixFile(parsed.data) }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
