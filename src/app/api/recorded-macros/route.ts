import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { RecordedMacroBody } from '@/server/control-plane-validators'
import { createRecordedMacro, listRecordedMacros } from '@/server/recorded-macro-service'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    recordedMacros: await listRecordedMacros(
      req.nextUrl.searchParams.get('softwareProfileId') ?? undefined,
    ),
  })
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, RecordedMacroBody)
  if (!parsed.ok) return parsed.response
  try {
    const recordedMacro = await createRecordedMacro(parsed.data)
    return NextResponse.json({ recordedMacro }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
