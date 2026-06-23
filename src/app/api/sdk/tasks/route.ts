import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, getRequestApiKey, parseJsonBody } from '@/app/api/control-plane-utils'
import { SdkTaskBody } from '@/server/control-plane-validators'
import {
  authenticateProgrammaticApiKey,
  createSdkTask,
  listSdkTasks,
} from '@/server/programmatic-api-service'

export async function GET() {
  return NextResponse.json({ sdkTasks: await listSdkTasks() })
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = await authenticateProgrammaticApiKey(getRequestApiKey(req))
    const parsed = await parseJsonBody(req, SdkTaskBody)
    if (!parsed.ok) return parsed.response
    return NextResponse.json(
      await createSdkTask({ ...parsed.data, apiKeyId: apiKey?.id ?? null }),
      { status: 201 },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
