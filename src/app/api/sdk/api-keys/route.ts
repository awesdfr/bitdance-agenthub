import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, parseJsonBody } from '@/app/api/control-plane-utils'
import { ProgrammaticApiKeyBody } from '@/server/control-plane-validators'
import {
  createProgrammaticApiKey,
  listProgrammaticApiKeys,
} from '@/server/programmatic-api-service'

export async function GET() {
  return NextResponse.json({ programmaticApiKeys: await listProgrammaticApiKeys() })
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseJsonBody(req, ProgrammaticApiKeyBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(await createProgrammaticApiKey(parsed.data), { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
