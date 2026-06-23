import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRequestApiKey, parseJsonBody } from '@/app/api/control-plane-utils'
import { SdkMemoryBody } from '@/server/control-plane-validators'
import {
  authenticateProgrammaticApiKey,
  createSdkMemory,
} from '@/server/programmatic-api-service'

export async function POST(req: NextRequest) {
  try {
    await authenticateProgrammaticApiKey(getRequestApiKey(req))
    const parsed = await parseJsonBody(req, SdkMemoryBody)
    if (!parsed.ok) return parsed.response
    const memoryItem = await createSdkMemory(parsed.data)
    return NextResponse.json({ memoryItem }, { status: 201 })
  } catch (err) {
    return errorResponse(err)
  }
}
